import { fieldHelperDeclarations } from "./fields.ts";
// The Effect-TS emitter. `emitModule` turns one
// `ModuleIR` into the text of one TypeScript module. It reads only the IR and
// the project configuration. It is synchronous and pure: the caller writes files.
import type { Declaration, ModuleIR, TypeDecl } from "../ir.ts";
import { indices } from "../runtime.ts";
import { caught, isInvariantFailure, type Result, rethrow } from "../source.ts";
import {
  fileNameOf,
  generatedHeader,
  isInterfacePath,
  sourceMapPathOf,
} from "../paths.ts";
import type { ProjectConfig } from "../project_config.ts";
import { bracketed, type Doc, hard, render, spanned } from "./doc.ts";
import {
  constantTypeDoc,
  DeclarationEmitter,
  functionHeaderDoc,
  orderConstants,
  orderTypeLevel,
} from "./decls.ts";
import type { EmittedModule, HostAssertionRecord } from "./emitted_module.ts";
import {
  type HelperKey,
  type ImportGroup,
  ModuleState,
} from "./module_state.ts";
import {
  atDeclaration,
  divideDeclaration,
  hostCheckDeclaration,
  intFunctionDeclaration,
  intSchemaDeclaration,
  outcomeDeclaration,
  remainderDeclaration,
  roundDeclaration,
  sortDeclaration,
  unmatchedDeclaration,
} from "./helper_declarations.ts";
export type EmitContext = {
  /** The project configuration, for the paths of host modules. */
  readonly config: ProjectConfig;
};
export type EmitError = {
  readonly tag: "internal";
  readonly module: string;
  readonly message: string;
};
function trueFlag(value: unknown): value is true {
  return typeof value === "boolean" && value;
}
function importLine(group: ImportGroup): Doc {
  const names = group.names.map((n) => {
    const base = n.exported === n.local
      ? n.exported
      : `${n.exported} as ${n.local}`;
    return n.typeOnly ? `type ${base}` : base;
  });
  return [
    "import ",
    bracketed("{", "}", names, true),
    ` from ${JSON.stringify(group.specifier)};`,
  ];
}
function blankSeparated(sections: readonly (readonly Doc[])[]): Doc {
  const nonEmpty = sections.filter((s) => s.length > 0);
  const out: Doc[] = [];
  for (const i of indices(nonEmpty.length)) {
    const section = nonEmpty[i];
    if (i > 0) {
      const _appendTarget1 = out;
      const _appendValues2 = [hard, hard];
      for (const _appendItem3 of _appendValues2) {
        _appendTarget1[_appendTarget1.length] = _appendItem3;
      }
    }
    for (const j of indices(section.length)) {
      const item = section[j];
      if (j > 0) {
        const _appendTarget4 = out;
        const _appendValue5 = hard;
        _appendTarget4[_appendTarget4.length] = _appendValue5;
      }
      {
        const _appendTarget6 = out;
        const _appendValue7 = item;
        _appendTarget6[_appendTarget6.length] = _appendValue7;
      }
    }
  }
  return out;
}
/**
 * A `nominal` type with an untagged, non-opaque body has its identity in the
 * checker only. The emitter reads it as an alias of its base.
 */
function erased<D extends Declaration | TypeDecl>(d: D): D {
  return d.kind === "type" && d.definition.kind === "nominal" &&
      !trueFlag(d.definition.tagged) && !trueFlag(d.opaque)
    ? { ...d, definition: { kind: "alias", type: d.definition.base } }
    : d;
}
function build(source: ModuleIR, context: EmitContext): EmittedModule {
  const ir: ModuleIR = {
    ...source,
    imports: source.imports.map((i) => ({ ...i, types: i.types.map(erased) })),
    declarations: source.declarations.map(erased),
  };
  const scope = ModuleState(ir, context.config);
  const emitter = DeclarationEmitter(scope);
  // An opaque type has no value: the host module declares it.
  const typeLevel = orderTypeLevel(ir).filter((d) =>
    !(d.kind === "type" && trueFlag(d.opaque))
  );
  const functions = ir.declarations.filter((d) => d.kind === "function");
  const constants = orderConstants(ir);
  function printed(
    declarations: readonly (typeof ir.declarations)[number][],
  ): Doc[] {
    return declarations.map((d) => spanned(d.span, emitter.declaration(d)));
  }
  // Declarations first: they decide which imports and helpers the module needs.
  const typeDocs = printed(typeLevel);
  const functionDocs = printed(functions);
  const constantDocs = printed(constants);
  // The host assertions come first: their check schemas register `$Int` and `$hostCheck`.
  const hostAssertions = emitter.hostAssertions();
  const helperDeclarations: readonly (readonly [
    HelperKey,
    () => Doc,
  ])[] = [
    ["intSchema", () => intSchemaDeclaration(scope)],
    ["intFunction", () => intFunctionDeclaration(scope)],
    ["remainder", () => remainderDeclaration(scope)],
    ["divide", () => divideDeclaration(scope)],
    ["round", () => roundDeclaration(scope)],
    ["at", () => atDeclaration(scope)],
    ["sort", () => sortDeclaration(scope)],
    ["unmatched", () => unmatchedDeclaration(scope)],
    ["hostCheck", () => hostCheckDeclaration(scope)],
    ["outcome", () => outcomeDeclaration(scope)],
  ];
  const helpers: Doc[][] = [];
  for (const entry of helperDeclarations) {
    const key = entry[0];
    const declaration = entry[1];
    if (scope.usesHelper(key)) {
      const _appendTarget8 = helpers;
      const _appendValue9 = [declaration()];
      _appendTarget8[_appendTarget8.length] = _appendValue9;
    }
  }
  {
    const _appendTarget10 = helpers;
    const _appendValue11 = fieldHelperDeclarations(scope);
    _appendTarget10[_appendTarget10.length] = _appendValue11;
  }
  // Every name and import is allocated by now: the import lists are final.
  const imports: Doc[] = scope.finish().map(importLine);
  const header: Doc = generatedHeader(scope.source);
  const declarationDocs = [...typeDocs, ...functionDocs, ...constantDocs];
  // A companion module without a declaration would not be a module without this line.
  const moduleMarker: Doc[] =
    isInterfacePath(scope.source) && declarationDocs.length === 0 &&
      imports.length === 0
      ? ["export {};"]
      : [];
  const doc = blankSeparated([
    [header],
    imports,
    ...helpers,
    hostAssertions,
    ...declarationDocs.map((d) => [d]),
    moduleMarker,
  ]);
  const mapName = fileNameOf(sourceMapPathOf(scope.path));
  const rendered = render(
    [doc, hard, `//# sourceMappingURL=${mapName}`, hard],
    undefined,
  );
  let assertions: HostAssertionRecord[] = rendered.marks.map((mark) => ({
    ...mark.data,
    start: mark.start,
    end: mark.end,
  }));
  assertions = assertions.sort((a, b) => a.start - b.start);
  return {
    module: ir.module,
    path: scope.path,
    text: rendered.text,
    spans: rendered.spans,
    hostAssertions: assertions,
  };
}
export function emitModule(
  ir: ModuleIR,
  context: EmitContext,
): Result<EmittedModule, EmitError> {
  return emitFailureAsResult(
    ir.module,
    () => ({ ok: true, value: build(ir, context) }),
  );
}
/** Returns an emitter invariant failure as an `EmitError` and rethrows other failures. */
function emitFailureAsResult<T, E>(
  module: string,
  run: () => Result<T, E>,
): Result<T, E | EmitError> {
  const done = caught(run);
  if (done.ok) {
    return done.value;
  }
  if (!isInvariantFailure(done.error, "emit")) {
    return rethrow(done.error);
  }
  return {
    ok: false,
    error: { tag: "internal", module: module, message: done.error.message },
  };
}
/** No backend type text exists: the declaration is missing, or it is neither a function nor a constant. */
type NoDeclarationType = {
  readonly tag: "unavailable";
};
/** One line, as the emitter prints the declaration header, without the width limit. */
function flatWidth(): number {
  return 1000000;
}
/**
 * The backend type text of one declaration of the IR on one line: the header
 * of a function or the type of a constant. Unlike `emitModule`, it does not
 * erase an untagged nominal type.
 */
export function declarationTypeText(
  ir: ModuleIR,
  context: EmitContext,
  id: DeclarationLookupId,
): Result<DeclarationTypeText, EmitError | NoDeclarationType> {
  const declaration = ir.declarations.find((d) => d.id === id);
  if (declaration === undefined) {
    return { ok: false, error: { tag: "unavailable" } };
  }
  return emitFailureAsResult(ir.module, () => {
    const scope = ModuleState(ir, context.config);
    if (declaration.kind === "function") {
      const doc = functionHeaderDoc(scope, declaration, "always");
      return { ok: true, value: render(doc, flatWidth()).text };
    }
    if (declaration.kind === "constant") {
      return {
        ok: true,
        value: render(constantTypeDoc(scope, declaration), flatWidth()).text,
      };
    }
    return { ok: false, error: { tag: "unavailable" } };
  });
}
export type DeclarationTypeText = string;
export type DeclarationLookupId = string;
