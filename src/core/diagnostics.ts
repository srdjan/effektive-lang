// Diagnostics are data. Each code has one entry in the registry below.
// A part registers only the codes that it emits.

import { compareSpans, type Span } from "./source.ts";

export type Category =
  | "syntax"
  | "unknown-name"
  | "type-mismatch"
  | "failure-contract"
  | "requirement-contract"
  | "execution-mode"
  | "pattern"
  | "declaration"
  | "module"
  | "sealed"
  | "host-boundary"
  | "validation";

export type Severity = "error";

interface CodeInfo {
  readonly description: string;
}

/**
 * The registry. A code is `<category>/<three digits>`. The category is the
 * part before the slash.
 */
export const DIAGNOSTIC_CODES = {
  "syntax/001": {
    description:
      "The source contains a character that the language does not use.",
  },
  "syntax/002": {
    description: "A string literal has no closing quote on its line.",
  },
  "syntax/003": {
    description:
      "A string literal contains an escape sequence or a raw control character that JSON does not allow.",
  },
  "syntax/004": {
    description:
      "A block comment has no closing marker before the end of the file.",
  },
  "syntax/005": {
    description:
      "A number literal is not a finite value, or a duration literal exceeds the largest safe integer in milliseconds.",
  },
  "syntax/006": {
    description: "A number literal is malformed.",
  },
  "syntax/007": {
    description: "A reserved JavaScript word is used as an identifier.",
  },
  "syntax/008": {
    description:
      "The parser expected a token or a construct that is not present.",
  },
  "syntax/009": {
    description:
      "The parser found a token that cannot start or continue a construct.",
  },
  "syntax/010": {
    description: "A unary operator is used. Version 0 has no unary operators.",
  },
  "syntax/011": {
    description: "A pattern is not one of the supported flat forms.",
  },
  "syntax/012": {
    description: "A host interface file contains a const declaration.",
  },
  "syntax/013": {
    description:
      "A provider declaration appears outside a host interface file.",
  },
  "syntax/014": {
    description:
      "A record expression has a spread that is not the first and only spread.",
  },
  "unknown-name/001": {
    description:
      "A name in an expression, a type, or a clause has no declaration or binding in scope.",
  },
  "unknown-name/002": {
    description:
      "An import names a declaration that the module does not have, or one that it does not export.",
  },
  "unknown-name/003": {
    description: "A service has no method with the given name.",
  },
  "unknown-name/004": {
    description:
      "A name resolves to a declaration of the wrong kind for its position, or a builtin appears outside a call.",
  },
  "syntax/015": {
    description:
      "Logical operands mixed with Option fallback need parentheses.",
  },
  "syntax/016": {
    description:
      "A record literal is the body of an arrow, a match arm, a handler, or a using acquisition without parentheses.",
  },
  "type-mismatch/001": {
    description:
      "A type has the wrong number of type arguments, or a name that takes no type arguments has some.",
  },
  "type-mismatch/002": {
    description:
      "void appears as a record field, an array element, or a tuple element.",
  },
  "type-mismatch/003": {
    description:
      "A value has a type that does not fit the type that its context expects: an argument, a result, a binding annotation, a field, or a branch.",
  },
  "type-mismatch/004": {
    description:
      "A call, a constructor, or a prelude function gets the wrong number of arguments.",
  },
  "type-mismatch/005": {
    description:
      "A record construction or update has a missing, duplicate, or unknown field, or an update has a base that is not a record.",
  },
  "type-mismatch/006": {
    description:
      "A field read names a field that the record type does not have, or reads a field of a value that is not a record.",
  },
  "type-mismatch/007": {
    description:
      "An operator or a condition gets an operand of the wrong type. Conditions must be boolean.",
  },
  "type-mismatch/008": {
    description:
      "A call names a value that is not a function, or a service method appears where it is not called.",
  },
  "type-mismatch/009": {
    description:
      "The branches of an if, a match, or a try have no common result type.",
  },
  "type-mismatch/010": {
    description:
      "A prelude function or constructor gets an argument that it does not accept: fail, retry, provide, an identity constructor, or a collection builtin.",
  },
  "type-mismatch/011": {
    description:
      "A callback parameter has no concrete type and its element type cannot be inferred.",
  },
  "type-mismatch/012": {
    description:
      "A bracket literal lacks an expected type for an empty list or has incompatible element types or tuple length.",
  },
  "type-mismatch/013": {
    description:
      "A value does not prove the required refinement, or the bounded solver cannot decide its obligation.",
  },
  "type-mismatch/014": {
    description:
      "Uses of one inferred input require conflicting types or identities.",
  },
  "failure-contract/001": {
    description:
      "The body of a function with a written fails clause can fail with errors that the clause does not list. An exported function and a function with a binding type annotation have a written fails clause, empty when omitted.",
  },
  "failure-contract/002": {
    description:
      "A catch handler names an error that the protected block cannot fail with.",
  },
  "failure-contract/003": {
    description: "A catch clause has two handlers for the same error.",
  },
  "failure-contract/004": {
    description:
      "A fails clause names a type alias with a member that is not an error.",
  },
  "requirement-contract/001": {
    description:
      "The body of a function with a closed `with` set needs service methods that the set does not list. A written clause and a binding type close the set. An export without a service header also closes an omitted set.",
  },
  "requirement-contract/002": {
    description:
      "A module with service headers produces or executes a requirement for a service that no service header declares.",
  },
  "execution-mode/001": {
    description:
      "A callback of map, filter, or fold is not pure, or has failures or requirements.",
  },
  "execution-mode/002": {
    description:
      "A module constant has an initializer that is not pure or has nonempty failure or requirement sets.",
  },
  "execution-mode/003": {
    description:
      "A function calls itself, directly or through other functions, without a parameter and result annotation, or a block-level function refers to itself.",
  },
  "execution-mode/004": {
    description:
      "The execution modes and effect sets of a recursive group did not settle within the round cap.",
  },
  "execution-mode/005": {
    description: "A pure function type declares a failure or requirement row.",
  },
  "pattern/001": {
    description:
      "A match does not cover every value of its subject. Unbounded primitives need a final wildcard.",
  },
  "pattern/002": {
    description:
      "A match arm can never run, because an earlier arm or a wildcard already matches its values.",
  },
  "pattern/003": {
    description:
      "A pattern names a constructor, a literal, or a tag that does not belong to the type of the subject.",
  },
  "pattern/004": {
    description:
      "A pattern is malformed for its use, or the subject has a type that version 0 cannot match.",
  },
  "declaration/001": {
    description:
      "Two declarations or bindings use the same name in one namespace or scope.",
  },
  "declaration/002": {
    description:
      "A declaration or binding uses a name that the prelude, the builtin types, or the generated TypeScript reserve.",
  },
  "declaration/003": {
    description:
      "A provider declaration names a service method or a non-service in its provides clause.",
  },
  "declaration/004": {
    description:
      "A block binding has the name of an outer binding that the block already used before the binding.",
  },
  "declaration/005": {
    description:
      "An exported function lacks a result annotation, and no binding type annotation supplies it.",
  },
  "declaration/006": {
    description:
      "An exported constant that is not a function has no binding type annotation.",
  },
  "declaration/007": {
    description:
      "A type definition refers to itself, directly or through other aliases, types with identity, or errors.",
  },
  "declaration/009": {
    description:
      "A tagged record or an error declaration has a field named _tag, which generated tags reserve. A union alias of its module tags a record.",
  },
  "declaration/010": {
    description: "A record type has two fields with the same name.",
  },
  "declaration/012": {
    description:
      "A type declaration is nested deeper than 128 levels, counting the levels inside its aliases.",
  },
  "declaration/013": {
    description:
      "A primitive type (string, int, number, boolean, or a literal type) appears outside the body of a type or error declaration.",
  },
  "declaration/015": {
    description:
      "A tagged record or an error declaration has a field whose type contains a function or deferred type (Effect, Stream, Sink, RetrySchedule, Ref, Schema, provider, or scope), directly or through an alias. The emitter has no schema for such a type.",
  },
  "declaration/016": {
    description:
      "A tagged record field or an error field contains an opaque type, directly or through an alias. An opaque type has no schema, so the emitter cannot build one for the declaration.",
  },
  "declaration/017": {
    description:
      "A sealed declaration has a body without identity: a union with a non-literal member, or a bare name. Only a type with identity can be sealed.",
  },
  "declaration/018": {
    description:
      "A refinement uses an unsupported predicate, applies to a type without identity, or enters a host interface contract.",
  },
  "module/001": {
    description:
      "A module reference is not valid: the import specifier or a project file entry breaks the module rules, or two files share one module name.",
  },
  "module/002": {
    description:
      "An import names a file or a host module that does not exist, is not registered, or cannot be read.",
  },
  "module/003": {
    description: "Modules import each other in a cycle.",
  },
  "module/004": {
    description:
      "Module constants depend on each other in a cycle, directly or through functions, so the module cannot initialize.",
  },
  "module/005": {
    description:
      "A direct import is not allowed by the first matching project import rule.",
  },
  "sealed/001": {
    description:
      "A module constructs a sealed type that another module declares.",
  },
  "sealed/002": {
    description:
      "A record update retains a sealed type outside its declaring module.",
  },
  "sealed/003": {
    description: "Arithmetic uses a sealed type outside its declaring module.",
  },
  "sealed/004": {
    description:
      "A module derives or executes a Schema that produces a foreign sealed type.",
  },
  "host-boundary/001": {
    description:
      "A host module does not match its declaration file: the TypeScript module that implements a provider disagrees with the provider type that the host interface file declares.",
  },
  "validation/001": {
    description:
      "Identity: a reference, a capability, an import, an export, a type name, or a declaration identity does not resolve in its scope, or an identity is declared twice.",
  },
  "validation/002": {
    description:
      "Types: a recorded type differs from the type that the validator recomputes, or an argument, a field, a branch, a pattern, or a function result does not fit its type.",
  },
  "validation/003": {
    description:
      "Contracts: a recorded failure set or requirement set differs from the recomputed set, or a function body exceeds the sets that its signature declares.",
  },
  "validation/004": {
    description:
      "Execution: a recorded execution mode differs from the recomputed mode, or a builtin callback is not pure with empty sets.",
  },
  "validation/005": {
    description:
      "Recovery: a catch handler names a tag that the protected block cannot fail with, a tag has two handlers, or the branches of a catch have no common type.",
  },
  "validation/006": {
    description:
      "Control: a retry job or a provide job is not a zero-argument function, a retry count is not a finite nonnegative safe integer, or a provider expression has no provider type.",
  },
  "validation/007": {
    description:
      "Initialization: a module constant has an initializer that is not pure or that has nonempty failure or requirement sets.",
  },
  "validation/008": {
    description:
      "Serialization: an effect set is not sorted and unique, a literal is not finite, a span names a source that is not supplied or lies outside its text, or the IR has an unexpected shape.",
  },
  "validation/009": {
    description:
      "Import binding: an import payload differs from the export of its producer module in the same validation call, in an identity, a type definition, an effect set, a predicate, an execution mode, a flag, or a service contract.",
  },
} as const satisfies Readonly<Record<`${Category}/${string}`, CodeInfo>>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;

export interface RelatedSpan {
  readonly span: Span;
  readonly message: string;
}

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly category: Category;
  readonly severity: Severity;
  readonly message: string;
  readonly span: Span;
  readonly related?: readonly RelatedSpan[];
}

export function registeredCodes(): readonly DiagnosticCode[] {
  return Object.keys(DIAGNOSTIC_CODES) as DiagnosticCode[];
}

export function categoryOf(code: DiagnosticCode): Category {
  // The cast is sound: the `satisfies` clause on DIAGNOSTIC_CODES requires
  // each key to start with `${Category}/`.
  return code.slice(0, code.indexOf("/")) as Category;
}

export function describeCode(code: DiagnosticCode): string {
  return DIAGNOSTIC_CODES[code].description;
}

export function makeDiagnostic(
  code: DiagnosticCode,
  message: string,
  span: Span,
  related?: readonly RelatedSpan[],
): Diagnostic {
  const base = {
    code,
    category: categoryOf(code),
    severity: "error" as const,
    message,
    span,
  };
  return related === undefined || related.length === 0
    ? base
    : { ...base, related };
}

/** Sorts by span, then code, then message. The input is not changed. */
export function sortDiagnostics(
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const bySpan = compareSpans(a.span, b.span);
    if (bySpan !== 0) return bySpan;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    return 0;
  });
}

/** Removes diagnostics with equal code, span, and message. Keeps the first of each. */
export function dedupeDiagnostics(
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const d of diagnostics) {
    const key =
      `${d.code}\u0000${d.span.source}\u0000${d.span.start}\u0000${d.span.end}\u0000${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(d);
  }
  return result;
}

/** Sort and dedupe. Publish diagnostics in this form. */
export function normalizeDiagnostics(
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  return dedupeDiagnostics(sortDiagnostics(diagnostics));
}
