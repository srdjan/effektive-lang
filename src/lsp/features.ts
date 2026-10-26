// The request handlers of the language features:
// hover, definition, document symbols, generated TypeScript, save, and stats,
// and the editor queries: references, rename, completion, signature help,
// semantic tokens, code actions, and inlay hints. Rename, code actions, and
// the other editor queries check that the revision matches the current text.
// Each handler calls `ctx.projects.forRequest`, which flushes a dirty project
// first, so that no answer comes from an old revision.
//
// This file imports only types from `server.ts`. The server imports the values
// of this file, so a value import back would form a cycle.

import type { TypeScriptOutputs } from "../core/typescript.ts";
import {
  completionsAt,
  CONFIG_FILE,
  contractActionsAt,
  definitionAt,
  documentSymbols,
  type EditorSymbol,
  type EditorSymbolKind,
  hoverAt,
  inlayHintsAt,
  joinPath,
  lineStarts,
  prepareRenameAt,
  referencesAt,
  renameAt,
  type Result,
  type Revision,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  semanticClassifications,
  signatureHelpAt,
  type SourceEdit,
  type Span,
} from "../core/mod.ts";
import {
  offsetToPosition,
  pathToUri,
  positionToOffset,
  spanToRange,
} from "./positions.ts";
import type {
  CodeActionParams,
  DocumentSymbol,
  EditorPositionParams,
  GeneratedChangedParams,
  GeneratedTypeScriptResult,
  Hover,
  InlayHintParams,
  Location,
  PositionParams,
  Range,
  ReferencesParams,
  RenameParams,
  StatsResult,
  TextDocumentParams,
} from "./protocol.ts";
import { GENERATED_CHANGED_METHOD } from "./methods.ts";
import { SymbolKind } from "./protocol.ts";
import type { ProjectState } from "./projects.ts";
import type { RequestFailure, ServerContext } from "./server.ts";

type Answer = Result<unknown, RequestFailure>;

function answer(value: unknown): Answer {
  return { ok: true, value };
}

const stale = (): Answer => ({
  ok: false,
  error: {
    code: -32801,
    message:
      "The document changed; request this edit again using the current text.",
  },
});

/** The module name of the `.eff` or `.effi` file `path` in the revision, or undefined. */
function sourceModuleOf(revision: Revision, path: string): string | undefined {
  return revision.moduleInfoAt(path)?.name;
}

/** The range of a span, against the text that the revision used for the span's file. */
function rangeOfSpan(revision: Revision, span: Span): Range | undefined {
  const text = revision.sourceTexts().get(span.source);
  if (text === undefined) return undefined;
  return spanToRange(text, lineStarts(text), span);
}

/** The place of a request: the project, its newest good revision, the file, and the offset. */
interface Cursor {
  readonly project: ProjectState;
  readonly revision: Revision;
  readonly path: string;
  readonly offset: number;
  readonly text: string;
}

/**
 * The cursor of a position request, or undefined when there is no good revision
 * or text. With `current`, the project must have no configuration error, and the
 * revision text must equal the open or disk text and the requested document
 * version. Hover and definition do not ask for this check.
 */
function cursorOf(
  params: EditorPositionParams,
  ctx: ServerContext,
  current = false,
): Cursor | undefined {
  const found = ctx.projects.forRequest(params.textDocument.uri);
  if (current && found?.project.configError !== undefined) return undefined;
  const revision = found?.project.lastGood;
  if (found === undefined || revision === undefined) return undefined;
  const { project, path } = found;
  const text = revision.sourceTexts().get(path);
  if (text === undefined) return undefined;
  if (current) {
    const open = project.open.get(path);
    if (
      (open?.text ?? project.disk.get(path)) !== text ||
      params.documentVersion !== undefined &&
        open?.version !== params.documentVersion
    ) return undefined;
  }
  const offset = positionToOffset(text, lineStarts(text), params.position);
  return { project, revision, path, offset, text };
}

/** The location of a span, or undefined when the text or the URI is not known. */
function locationOf(cursor: Cursor, span: Span): Location | undefined {
  const range = rangeOfSpan(cursor.revision, span);
  const uri = pathToUri(joinPath(cursor.project.root, span.source));
  return range === undefined || uri === undefined ? undefined : { uri, range };
}

// ---- Hover ------------------------------------------------------------------

function fenced(language: string, body: string): string {
  return "```" + language + "\n" + body + "\n```";
}

/** `textDocument/hover` (plan 5.6). */
export function hoverRequest(
  params: PositionParams,
  ctx: ServerContext,
): Answer {
  const cursor = cursorOf(params, ctx);
  if (cursor === undefined) return answer(null);
  const { revision } = cursor;
  const hit = hoverAt(
    revision,
    cursor.path,
    cursor.offset,
    cursor.project.outputs,
  );
  if (hit === undefined) return answer(null);
  const range = rangeOfSpan(revision, hit.span);
  if (range === undefined) return answer(null);
  let value = fenced("effektive", hit.contract);
  if (hit.backend?.tag === "type") {
    value += "\n\n" + fenced("typescript", hit.backend.text);
  } else if (hit.backend?.tag === "unavailable") {
    value += "\n\nbackend type: not available while the module has errors";
  }
  const result: Hover = { contents: { kind: "markdown", value }, range };
  return answer(result);
}

// ---- Definition -------------------------------------------------------------

/** `textDocument/definition` (plan 5.7). */
export function definitionRequest(
  params: PositionParams,
  ctx: ServerContext,
): Answer {
  const cursor = cursorOf(params, ctx);
  if (cursor === undefined) return answer(null);
  const { revision } = cursor;
  const span = definitionAt(revision, cursor.path, cursor.offset);
  if (span === undefined) return answer(null);
  return answer(locationOf(cursor, span) ?? null);
}

// ---- Document symbols -------------------------------------------------------

const SYMBOL_KINDS: Readonly<Record<EditorSymbolKind, number>> = {
  function: SymbolKind.Function,
  constant: SymbolKind.Constant,
  type: SymbolKind.Struct,
  error: SymbolKind.Class,
  service: SymbolKind.Interface,
  method: SymbolKind.Method,
  provider: SymbolKind.Variable,
};

function convertSymbol(
  symbol: EditorSymbol,
  text: string,
  starts: Uint32Array,
): DocumentSymbol {
  const base = {
    name: symbol.name,
    kind: SYMBOL_KINDS[symbol.kind],
    range: spanToRange(text, starts, symbol.span),
    selectionRange: spanToRange(text, starts, symbol.nameSpan),
  };
  return symbol.children.length === 0 ? base : {
    ...base,
    children: symbol.children.map((child) =>
      convertSymbol(child, text, starts)
    ),
  };
}

/**
 * `textDocument/documentSymbol` (plan 5.7). The text is the open document, else
 * the disk text, else the text of the revision. Without a revision, the file is
 * parsed on its own.
 */
export function documentSymbolRequest(
  params: TextDocumentParams,
  ctx: ServerContext,
): Answer {
  const found = ctx.projects.forRequest(params.textDocument.uri);
  if (found === undefined) return answer(null);
  const { project, path } = found;
  const text = project.open.get(path)?.text ?? project.disk.get(path) ??
    project.lastGood?.sourceTexts().get(path);
  if (text === undefined) return answer(null);
  const starts = lineStarts(text);
  const symbols = documentSymbols(project.lastGood, path, text);
  return answer(symbols.map((symbol) => convertSymbol(symbol, text, starts)));
}

// ---- Generated TypeScript ---------------------------------------------------

interface GeneratedEntry {
  /** The URI that the client used in its request. */
  uri: string;
  /** The text of the newest emit that succeeded in this server session. */
  lastGood: string | undefined;
  /** What the client has now, through a response or a notification. */
  received: GeneratedTypeScriptResult | undefined;
}

/**
 * The generated TypeScript of the subscribed modules (plan 5.8). A request
 * subscribes the module. After each flush that produced a revision, the tracker
 * sends `effektive/generatedChanged` for each subscribed module whose text or
 * stale flag differs from what the client has.
 */
export class GeneratedTexts {
  readonly #entries = new WeakMap<
    ProjectState,
    Map<string, GeneratedEntry>
  >();

  #entriesOf(project: ProjectState): Map<string, GeneratedEntry> {
    let entries = this.#entries.get(project);
    if (entries === undefined) {
      entries = new Map();
      this.#entries.set(project, entries);
    }
    return entries;
  }

  #current(
    revision: Revision,
    path: string,
    entry: GeneratedEntry,
    outputs: TypeScriptOutputs,
  ): GeneratedTypeScriptResult | null {
    const name = sourceModuleOf(revision, path);
    const emitted = name === undefined
      ? undefined
      : outputs.emitted(revision, name);
    if (emitted !== undefined && emitted.ok) {
      entry.lastGood = emitted.value.text;
      return { text: emitted.value.text, stale: false };
    }
    return entry.lastGood === undefined
      ? null
      : { text: entry.lastGood, stale: true };
  }

  /** Answers `effektive/generatedTypeScript` and subscribes the module. */
  request(
    project: ProjectState,
    path: string,
    uri: string,
  ): GeneratedTypeScriptResult | null {
    if (!path.endsWith(".eff") && !path.endsWith(".effi")) return null;
    const entries = this.#entriesOf(project);
    let entry = entries.get(path);
    if (entry === undefined) {
      entry = { uri, lastGood: undefined, received: undefined };
      entries.set(path, entry);
    }
    entry.uri = uri;
    const revision = project.lastGood;
    if (revision === undefined) return null;
    const result = this.#current(revision, path, entry, project.outputs);
    if (result !== null) entry.received = result;
    return result;
  }

  /** Called after a flush that produced a revision. */
  afterFlush(
    project: ProjectState,
    revision: Revision,
    notify: (method: string, params: unknown) => void,
  ): void {
    const entries = this.#entries.get(project);
    if (entries === undefined) return;
    for (const [path, entry] of entries) {
      const result = this.#current(revision, path, entry, project.outputs);
      if (result === null) continue;
      const before = entry.received;
      if (
        before !== undefined && before.text === result.text &&
        before.stale === result.stale
      ) continue;
      entry.received = result;
      const params: GeneratedChangedParams = { uri: entry.uri };
      notify(GENERATED_CHANGED_METHOD, params);
    }
  }
}

/** `effektive/generatedTypeScript` (plan 5.8). */
export function generatedTypeScriptRequest(
  params: TextDocumentParams,
  ctx: ServerContext,
): Answer {
  const uri = params.textDocument.uri;
  const found = ctx.projects.forRequest(uri);
  if (found === undefined) return answer(null);
  return answer(ctx.generated.request(found.project, found.path, uri));
}

// ---- Save -------------------------------------------------------------------

/**
 * `textDocument/didSave` (plan 5.9, plan SV). A save of a `.eff` or `.effi`
 * document of a known project starts a save round, which brings every output
 * of the project up to date from the disk texts. The round does nothing when
 * `writeOnSave` is false.
 */
export function didSave(params: TextDocumentParams, ctx: ServerContext): void {
  const found = ctx.projects.lookup(params.textDocument.uri);
  if (found === undefined) return;
  if (!found.path.endsWith(".eff") && !found.path.endsWith(".effi")) return;
  ctx.projects.saveRound(found.project);
}

// ---- Stats ------------------------------------------------------------------

/** `effektive/stats` (plan 5.11). */
export function statsRequest(
  params: TextDocumentParams,
  ctx: ServerContext,
): Answer {
  const found = ctx.projects.forRequest(params.textDocument.uri);
  if (found === undefined) return answer(null);
  const { project } = found;
  const revision = project.lastGood;
  const { parses, checks, lowerings } = project.program.counts;
  const { emits } = project.outputs.counts;
  const result: StatsResult = {
    revision: revision?.number ?? 0,
    rechecked: revision === undefined ? [] : [...revision.rechecked],
    counts: { parses, checks, lowerings, emits },
    delta: {
      interfaceChanged: [...(project.lastDelta?.interfaceChanged ?? [])],
      modeChanged: [...(project.lastDelta?.modeChanged ?? [])],
    },
    typeTableSize: revision?.types.size ?? 0,
    memory: ctx.memory(),
  };
  return answer(result);
}

// ---- Editor queries ---------------------------------------------------------

function freshProject(cursor: Cursor, ctx: ServerContext): boolean {
  const { project, revision } = cursor;
  if (project.configError !== undefined) return false;
  const config = project.open.get(CONFIG_FILE)?.text;
  const diskConfig = config === undefined
    ? ctx.fs.readText(joinPath(project.root, CONFIG_FILE))
    : undefined;
  const currentConfig = config ??
    (diskConfig?.ok ? diskConfig.value : undefined);
  if (
    currentConfig === undefined ||
    currentConfig !== project.current.get(CONFIG_FILE)
  ) return false;
  for (const [path, text] of revision.sourceTexts()) {
    const open = project.open.get(path);
    if (open !== undefined) { if (open.text !== text) return false; }
    else {
      const disk = ctx.fs.readText(joinPath(project.root, path));
      if (!disk.ok || disk.value !== text) return false;
    }
  }
  return true;
}

function workspaceEdit(
  cursor: Cursor,
  edits: readonly SourceEdit[],
): unknown {
  const grouped = new Map<string, SourceEdit[]>();
  for (const edit of edits) {
    const group = grouped.get(edit.span.source) ?? [];
    group.push(edit);
    grouped.set(edit.span.source, group);
  }
  return {
    documentChanges: [...grouped].map(([path, changes]) => {
      const text = cursor.revision.sourceTexts().get(path) ?? "";
      const starts = lineStarts(text);
      return {
        textDocument: {
          uri: pathToUri(joinPath(cursor.project.root, path)),
          version: cursor.project.open.get(path)?.version ?? null,
        },
        edits: changes.map((change) => ({
          range: spanToRange(text, starts, change.span),
          newText: change.text,
        })),
      };
    }),
  };
}

export function referencesRequest(
  params: ReferencesParams,
  ctx: ServerContext,
): Answer {
  const cursor = cursorOf(params, ctx, true);
  return answer(
    cursor === undefined ? [] : referencesAt(
      cursor.revision,
      cursor.path,
      cursor.offset,
      params.includeDeclaration,
    ).map((span) => locationOf(cursor, span)).filter((loc) =>
      loc !== undefined
    ),
  );
}

export function prepareRenameRequest(
  params: EditorPositionParams,
  ctx: ServerContext,
): Answer {
  const cursor = cursorOf(params, ctx, true);
  if (cursor === undefined || !freshProject(cursor, ctx)) return stale();
  const prepared = prepareRenameAt(
    cursor.revision,
    cursor.path,
    cursor.offset,
  );
  return answer(
    prepared === undefined ? null : {
      range: spanToRange(
        cursor.text,
        lineStarts(cursor.text),
        prepared.span,
      ),
      placeholder: prepared.name,
    },
  );
}

export function renameRequest(
  params: RenameParams,
  ctx: ServerContext,
): Answer {
  const cursor = cursorOf(params, ctx, true);
  if (cursor === undefined || !freshProject(cursor, ctx)) return stale();
  const result = renameAt(
    cursor.revision,
    cursor.path,
    cursor.offset,
    params.newName,
  );
  return result.ok
    ? answer(workspaceEdit(cursor, result.value))
    : { ok: false, error: { code: -32602, message: result.error } };
}

const completionKinds = {
  variable: 6,
  function: 3,
  type: 7,
  class: 7,
  interface: 8,
  method: 2,
  property: 10,
  keyword: 14,
} as const;
export function completionRequest(
  params: EditorPositionParams,
  ctx: ServerContext,
): Answer {
  const cursor = cursorOf(params, ctx, true);
  if (cursor === undefined) return answer({ isIncomplete: false, items: [] });
  const starts = lineStarts(cursor.text);
  return answer({
    isIncomplete: false,
    items: completionsAt(cursor.revision, cursor.path, cursor.offset).map(
      (item) => ({
        label: item.label,
        kind: completionKinds[item.kind],
        textEdit: {
          range: spanToRange(cursor.text, starts, item.span),
          newText: item.label,
        },
      }),
    ),
  });
}

export function signatureHelpRequest(
  params: EditorPositionParams,
  ctx: ServerContext,
): Answer {
  const cursor = cursorOf(params, ctx, true);
  if (cursor === undefined) return answer(null);
  const found = signatureHelpAt(
    cursor.revision,
    cursor.path,
    cursor.offset,
  );
  return answer(
    found === undefined ? null : {
      signatures: [{
        label: found.label,
        parameters: found.parameters,
      }],
      activeSignature: 0,
      activeParameter: found.activeParameter,
    },
  );
}

export function semanticTokensRequest(
  params: TextDocumentParams,
  ctx: ServerContext,
): Answer {
  const found = ctx.projects.forRequest(params.textDocument.uri);
  if (found === undefined) return answer({ data: [] });
  const { project, path } = found;
  const text = project.open.get(path)?.text ?? project.disk.get(path);
  if (text === undefined) return answer({ data: [] });
  const starts = lineStarts(text);
  const tokens = semanticClassifications(
    project.configError === undefined ? project.lastGood : undefined,
    path,
    text,
  );
  const data: number[] = [];
  let previousLine = 0, previousCharacter = 0;
  for (const token of tokens) {
    let at = token.span.start;
    while (at < token.span.end) {
      const newline = text.indexOf("\n", at);
      const end = Math.min(token.span.end, newline < 0 ? text.length : newline);
      const contentEnd = end > at && text[end - 1] === "\r" ? end - 1 : end;
      if (contentEnd > at) {
        const position = offsetToPosition(text, starts, at);
        data.push(
          position.line - previousLine,
          position.line === previousLine
            ? position.character - previousCharacter
            : position.character,
          contentEnd - at,
          SEMANTIC_TOKEN_TYPES.indexOf(token.type),
          token.modifiers.reduce(
            (bits, modifier) =>
              bits | 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf(modifier),
            0,
          ),
        );
        previousLine = position.line;
        previousCharacter = position.character;
      }
      at = end + 1;
    }
  }
  return answer({ data });
}

export function codeActionRequest(
  params: CodeActionParams,
  ctx: ServerContext,
): Answer {
  const cursor = cursorOf(
    { ...params, position: params.range.start },
    ctx,
    true,
  );
  if (cursor === undefined || !freshProject(cursor, ctx)) return answer([]);
  const end = positionToOffset(
    cursor.text,
    lineStarts(cursor.text),
    params.range.end,
  );
  return answer(
    contractActionsAt(cursor.revision, cursor.path, cursor.offset, end).map(
      (action) => ({
        title: action.title,
        kind: "quickfix",
        edit: workspaceEdit(cursor, action.edits),
      }),
    ),
  );
}

/** Kind 1 (Type): the label states an inferred contract. */
export function inlayHintRequest(
  params: InlayHintParams,
  ctx: ServerContext,
): Answer {
  const cursor = cursorOf(
    { ...params, position: params.range.start },
    ctx,
    true,
  );
  if (cursor === undefined) return answer([]);
  const { text } = cursor;
  const starts = lineStarts(text);
  return answer(
    inlayHintsAt(cursor.revision, cursor.path, {
      start: cursor.offset,
      end: positionToOffset(text, starts, params.range.end),
    }).map((hint) => ({
      position: offsetToPosition(text, starts, hint.position),
      label: hint.label,
      kind: 1,
      paddingLeft: false,
    })),
  );
}
