import { fieldHelperDeclarations } from "./fields.ts";
// The Effect-TS emitter. `emitModule` turns one
// `ModuleIR` into the text of one TypeScript module. It reads only the IR and
// the project configuration. It is synchronous and pure: the caller writes files.

import type { Declaration, ModuleIR, TypeDecl } from "../ir.ts";
import type { Result } from "../result.ts";
import { generatedHeader, isInterfacePath } from "../paths.ts";
import type { ProjectConfig } from "../project_config.ts";
import { bracketed, type Doc, hard, render, spanned } from "./doc.ts";
import {
  constantTypeDoc,
  DeclarationEmitter,
  exportedIds,
  functionHeaderDoc,
  orderConstants,
  orderTypeLevel,
  recursiveGroups,
} from "./decls.ts";
import { EmitFailure } from "./failure.ts";
import type { EmittedModule, HostAssertionRecord } from "./emitted_module.ts";
import {
  type HelperKey,
  type ImportGroup,
  ModuleState,
} from "./module_state.ts";
import {
  hostCheckDeclaration,
  intFunctionDeclaration,
  intSchemaDeclaration,
  outcomeDeclaration,
  unmatchedDeclaration,
} from "./helper_declarations.ts";

export interface EmitContext {
  /** The project configuration, for the paths of host modules. */
  readonly config: ProjectConfig;
}

export type EmitError = {
  readonly tag: "internal";
  readonly module: string;
  readonly message: string;
};

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
  nonEmpty.forEach((section, i) => {
    if (i > 0) out.push(hard, hard);
    section.forEach((item, j) => {
      if (j > 0) out.push(hard);
      out.push(item);
    });
  });
  return out;
}

/**
 * A `nominal` type with an untagged, non-opaque body has its identity in the
 * checker only. The emitter reads it as an alias of its base.
 */
function erased<D extends Declaration | TypeDecl>(d: D): D {
  return d.kind === "type" && d.definition.kind === "nominal" &&
      d.definition.tagged !== true && d.opaque !== true
    ? { ...d, definition: { kind: "alias", type: d.definition.base } }
    : d;
}

function normalized(ir: ModuleIR): ModuleIR {
  return {
    ...ir,
    imports: ir.imports.map((i) => ({ ...i, types: i.types.map(erased) })),
    declarations: ir.declarations.map(erased),
  };
}

function build(source: ModuleIR, context: EmitContext): EmittedModule {
  const ir = normalized(source);
  const scope = new ModuleState(ir, context.config);
  const exported = exportedIds(ir);
  const emitter = new DeclarationEmitter(
    scope,
    exported,
    recursiveGroups(ir),
  );

  // An opaque type has no value: the host module declares it.
  const typeLevel = orderTypeLevel(ir).filter((d) =>
    !(d.kind === "type" && d.opaque === true)
  );
  const functions = ir.declarations.filter((d) => d.kind === "function");
  const constants = orderConstants(ir);
  const printed = (declarations: readonly (typeof ir.declarations)[number][]) =>
    declarations.map((d) => spanned(d.span, emitter.declaration(d)));
  // Declarations first: they decide which imports and helpers the module needs.
  const typeDocs = printed(typeLevel);
  const functionDocs = printed(functions);
  const constantDocs = printed(constants);

  // The host assertions come first: their check schemas register `$Int` and `$hostCheck`.
  const hostAssertions = emitter.hostAssertions();
  const helperDeclarations: readonly (readonly [HelperKey, () => Doc])[] = [
    ["intSchema", () => intSchemaDeclaration(scope)],
    ["intFunction", () => intFunctionDeclaration(scope)],
    ["unmatched", () => unmatchedDeclaration(scope)],
    ["hostCheck", () => hostCheckDeclaration(scope)],
    ["outcome", () => outcomeDeclaration(scope)],
  ];
  const helpers: Doc[][] = [];
  for (const [key, declaration] of helperDeclarations) {
    if (scope.usesHelper(key)) helpers.push([declaration()]);
  }

  helpers.push(fieldHelperDeclarations(scope));

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
  const mapName = `${scope.path.slice(scope.path.lastIndexOf("/") + 1)}.map`;
  const rendered = render([doc, hard, `//# sourceMappingURL=${mapName}`, hard]);
  const assertions: HostAssertionRecord[] = rendered.marks.map((mark) => ({
    ...mark.data,
    start: mark.start,
    end: mark.end,
  }));
  assertions.sort((a, b) => a.start - b.start);
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
  try {
    return { ok: true, value: build(ir, context) };
  } catch (e) {
    if (e instanceof EmitFailure) {
      return {
        ok: false,
        error: { tag: "internal", module: ir.module, message: e.message },
      };
    }
    throw e;
  }
}

/** No backend type text exists: the declaration is missing, or it is neither a function nor a constant. */
export type NoDeclarationType = { readonly tag: "unavailable" };

/** One line, as the emitter prints the declaration header, without the width limit. */
const FLAT_WIDTH = 1_000_000;

/**
 * The backend type text of one declaration of the IR on one line: the header
 * of a function or the type of a constant. Unlike `emitModule`, it does not
 * erase an untagged nominal type, so the text is the same as hover printed
 * before this function existed.
 */
export function declarationTypeText(
  ir: ModuleIR,
  context: EmitContext,
  id: string,
): Result<string, EmitError | NoDeclarationType> {
  const declaration = ir.declarations.find((d) => d.id === id);
  if (declaration === undefined) {
    return { ok: false, error: { tag: "unavailable" } };
  }
  try {
    const scope = new ModuleState(ir, context.config);
    if (declaration.kind === "function") {
      const doc = functionHeaderDoc(scope, declaration, "always");
      return { ok: true, value: render(doc, FLAT_WIDTH).text };
    }
    if (declaration.kind === "constant") {
      return {
        ok: true,
        value: render(constantTypeDoc(scope, declaration), FLAT_WIDTH).text,
      };
    }
    return { ok: false, error: { tag: "unavailable" } };
  } catch (e) {
    if (e instanceof EmitFailure) {
      return {
        ok: false,
        error: { tag: "internal", module: ir.module, message: e.message },
      };
    }
    throw e;
  }
}
