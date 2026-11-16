import type { Predicate, ProofCertificate } from "./predicates.ts";

// Typed compiler contract. The sibling website publishes a standalone copy.
export type TypeId = `type:${string}`;
export type ErrorId = `error:${string}`;
export type ServiceId = `service:${string}`;
export type CapabilityId = `cap:${string}`;
/** A reserved Effect runtime requirement, discharged by `scoped`. */
export const SCOPE_CAPABILITY: CapabilityId = "cap:effect/Scope";
/** The target Schema parser failure; source code may handle but not construct it. */
export const SCHEMA_ERROR_ID: ErrorId = "error:effect/SchemaError";
export const SCHEMA_ISSUE_ID: ErrorId = "error:effect/SchemaIssue";
/** The target timeout failure of `timeout`; source code may handle but not construct it. */
export const TIMEOUT_ERROR_ID: ErrorId = "error:effect/TimeoutError";
/**
 * The builtin untagged identity over `int` that types a duration. At run time it
 * is a number of milliseconds. It is closed: an unnamed value never fits it.
 */
export const DURATION_ID: TypeId = "type:effect/Duration";
/**
 * The builtin untagged identity over `int` that types a point in time. At run
 * time it is a number of milliseconds since the Unix epoch. It is closed.
 */
export const INSTANT_ID: TypeId = "type:effect/Instant";
export type IdentityCandidate = string;
export type UnitIdentityMatch = boolean;
/** The closed builtin unit identities: no unnamed value fits one, and each erases to a number. */
export function isClosedUnitId(id: IdentityCandidate): UnitIdentityMatch {
  return id === DURATION_ID || id === INSTANT_ID;
}
/** The levels of `log`, in the order of increasing severity. The default is "info". */
export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;
export type LogLevel = typeof LOG_LEVELS[number];
export type ValueId = `value:${string}`;
export type LocalId = `local:${string}`;
export type Execution = "pure" | "effect";

/** Offsets count UTF-16 code units. The end offset is exclusive. */
export type Span = {
  readonly source: string;
  readonly start: number;
  readonly end: number;
};

/** These sets are closed. Serialization sorts IDs and removes duplicates. */
export type Effects = {
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
};

export type Field = {
  readonly name: string;
  readonly type: Type;
  readonly optional: boolean;
};

/** Function effects describe invocation. Constructing a closure remains pure. */
export type FunctionType = {
  readonly kind: "function";
  readonly execution: Execution;
  readonly parameters: readonly Type[];
  readonly borrows?: readonly boolean[];
  /** Checked inputs accept raw unknown values and validate before body execution. */
  readonly checked?: readonly boolean[];
  readonly result: Type;
  readonly effects: Effects;
};

export type Type =
  | { readonly kind: "primitive"; readonly name: "string" | "boolean" | "int" | "number" | "unit" | "never" | "unknown" }
  | { readonly kind: "literal"; readonly value: string | number | boolean | null }
  | { readonly kind: "named"; readonly id: TypeId | ErrorId }
  | { readonly kind: "record"; readonly fields: readonly Field[] }
  | { readonly kind: "array"; readonly element: Type }
  | { readonly kind: "tuple"; readonly elements: readonly Type[] }
  | { readonly kind: "union"; readonly members: readonly Type[] }
  | { readonly kind: "option"; readonly element: Type }
  | { readonly kind: "ref"; readonly element: Type }
  | { readonly kind: "retry-schedule"; readonly error: Type }
  // Constructor defaults may coexist with one field-presence flag.
  | { readonly kind: "schema"; readonly decoded: Type; readonly encoded: Type; readonly decodeRequirements: readonly CapabilityId[]; readonly encodeRequirements: readonly CapabilityId[]; readonly optionalKey?: true; readonly encodedOptionalKey?: true; readonly decodedOptionalKey?: true; readonly makeInput?: Type; readonly constructorDefault?: true }
  | { readonly kind: "effect"; readonly result: Type; readonly effects: Effects }
  | { readonly kind: "stream"; readonly element: Type; readonly effects: Effects }
  | { readonly kind: "sink"; readonly input: Type; readonly result: Type; readonly leftover?: Type; readonly effects: Effects }
  | FunctionType
  | {
      readonly kind: "provider";
      readonly provides: readonly CapabilityId[];
      readonly acquisition: {
        readonly execution: Execution;
        readonly effects: Effects;
      };
    };

export type Parameter = {
  readonly id: LocalId;
  readonly name: string;
  readonly type: Type;
  readonly borrow?: boolean;
  readonly span: Span;
};

export type RefinementProof = {
  readonly target: TypeId;
  readonly certificate: ProofCertificate;
};

export type Annotation = {
  readonly proofs?: readonly RefinementProof[];
  readonly type: Type;
  /** Execution mode remains independent of unhandled failures and requirements. */
  readonly execution: Execution;
  /** Active effects for this evaluation, including effects of evaluated children. */
  readonly effects: Effects;
  readonly span: Span;
};

type Node<T> = Readonly<T> & Annotation;

export type Pattern =
  | { readonly kind: "wildcard"; readonly span: Span }
  | { readonly kind: "literal"; readonly value: string | number | boolean | null; readonly span: Span }
  | { readonly kind: "duration"; readonly millis: number; readonly span: Span }
  | { readonly kind: "none"; readonly span: Span }
  | { readonly kind: "bind"; readonly binding: Parameter; readonly span: Span }
  | { readonly kind: "some"; readonly binding: Parameter; readonly span: Span }
  | { readonly kind: "error"; readonly error: ErrorId; readonly binding: Parameter; readonly span: Span }
  | { readonly kind: "nominal"; readonly nominal: TypeId; readonly binding: Parameter; readonly span: Span }
  | { readonly kind: "tag"; readonly field: string; readonly value: string; readonly binding: Parameter | null; readonly span: Span };

export type Arm = {
  readonly pattern: Pattern;
  readonly body: Expr;
};

export type Handler = {
  readonly error: ErrorId;
  readonly binding: Parameter;
  readonly body: Expr;
  readonly span: Span;
};

/** The `Defect(name) => expression` arm of a catch. The binding is `{ message: string }`. */
export type DefectHandler = {
  readonly binding: Parameter;
  readonly body: Expr;
  readonly span: Span;
};

export type Step =
  | { readonly kind: "bind"; readonly binding: Parameter; readonly value: Expr; readonly generated?: true }
  | { readonly kind: "evaluate"; readonly value: Expr };

export type ClosureExpr = Node<{ readonly kind: "closure"; readonly parameters: readonly Parameter[]; readonly body: Expr }>;

/** Calls and capability operations remain distinct after resolution. */
export type Expr =
  // A null value in the original literal node represents unit, emitted as undefined.
  | Node<{ readonly kind: "literal"; readonly value: string | number | boolean | null }>
  // Source null data is distinct from the existing unit marker.
  | Node<{ readonly kind: "null" }>
  | Node<{ readonly kind: "reference"; readonly target: LocalId | ValueId }>
  | Node<{ readonly kind: "record"; readonly fields: readonly { readonly name: string; readonly value: Expr }[] }>
  | Node<{ readonly kind: "array"; readonly elements: readonly Expr[] }>
  | Node<{ readonly kind: "tuple"; readonly elements: readonly Expr[] }>
  | Node<{ readonly kind: "get"; readonly record: Expr; readonly field: string }>
  | Node<{ readonly kind: "update"; readonly record: Expr; readonly fields: readonly { readonly name: string; readonly value: Expr }[] }>
  | Node<{ readonly kind: "nominal"; readonly nominal: TypeId; readonly value: Expr }>
  | Node<{ readonly kind: "some"; readonly value: Expr }>
  | Node<{ readonly kind: "none" }>
  | Node<{ readonly kind: "error"; readonly error: ErrorId; readonly fields: readonly { readonly name: string; readonly value: Expr }[] }>
  | ClosureExpr
  | Node<{ readonly kind: "call"; readonly callee: Expr; readonly arguments: readonly Expr[] }>
  | Node<{ readonly kind: "defer"; readonly job: Expr }>
  | Node<{ readonly kind: "run"; readonly value: Expr }>
  | Node<{ readonly kind: "scoped"; readonly value: Expr }>
  | Node<{ readonly kind: "fork-scoped"; readonly job: Expr }>
  | Node<{ readonly kind: "with-resource"; readonly acquire: ClosureExpr; readonly use: ClosureExpr; readonly release: ClosureExpr }>
  | Node<{ readonly kind: "unfold"; readonly seed: Expr; readonly next: Expr }>
  | Node<{ readonly kind: "map-effect"; readonly stream: Expr; readonly transform: Expr; readonly concurrency: number | "unbounded" | undefined }>
  | Node<{ readonly kind: "map-stream"; readonly stream: Expr; readonly transform: Expr }>
  | Node<{ readonly kind: "sink-for-each"; readonly consume: Expr }>
  | Node<{ readonly kind: "take-sink"; readonly count: number }>
  | Node<{ readonly kind: "transduce-stream"; readonly stream: Expr; readonly sink: Expr }>
  | Node<{ readonly kind: "run-stream"; readonly stream: Expr; readonly sink: Expr }>
  | Node<{ readonly kind: "buffer-stream"; readonly stream: Expr; readonly capacity: number }>
  | Node<{ readonly kind: "race"; readonly left: Expr; readonly right: Expr }>
  | Node<{ readonly kind: "race-all"; readonly jobs: Expr }>
  | Node<{ readonly kind: "make-ref"; readonly value: Expr }>
  | Node<{ readonly kind: "get-ref"; readonly ref: Expr }>
  | Node<{ readonly kind: "set-ref"; readonly ref: Expr; readonly value: Expr }>
  | Node<{ readonly kind: "update-ref"; readonly ref: Expr; readonly transform: Expr }>
  | Node<{ readonly kind: "layer"; readonly service: ServiceId; readonly acquire: Expr }>
  | Node<{ readonly kind: "merge-layers"; readonly left: Expr; readonly right: Expr }>
  | Node<{ readonly kind: "retry-schedule"; readonly step: Expr }>
  | Node<{ readonly kind: "retry-with-schedule"; readonly job: Expr; readonly options: Expr }>
  | Node<{ readonly kind: "schema"; readonly op: "identity" | "array" | "struct" | "optional-key" | "null-to-missing-key" | "option-from-optional-key" | "default-key" | "constructor-default" | "default-null-key" | "default-encoded-key" | "optional-transform" | "optional-from-required" | "union" | "transform" | "recursive"; readonly arguments: readonly Expr[] }>
  | Node<{ readonly kind: "schema-decode"; readonly schema: Expr; readonly input: Expr }>
  | Node<{ readonly kind: "schema-encode"; readonly schema: Expr; readonly input: Expr }>
  | Node<{ readonly kind: "schema-make"; readonly schema: Expr; readonly input: Expr }>
  | Node<{ readonly kind: "perform"; readonly capability: CapabilityId; readonly arguments: readonly Expr[] }>
  | Node<{ readonly kind: "block"; readonly steps: readonly Step[]; readonly result: Expr }>
  | Node<{ readonly kind: "if"; readonly condition: Expr; readonly then: Expr; readonly else: Expr }>
  | Node<{ readonly kind: "match"; readonly subject: Expr; readonly arms: readonly Arm[] }>
  | Node<{ readonly kind: "fail"; readonly error: Expr }>
  | Node<{
    readonly kind: "catch";
    readonly body: Expr;
    readonly handlers: readonly Handler[];
    readonly defect?: DefectHandler;
  }>
  | Node<{ readonly kind: "ensure"; readonly body: Expr; readonly finalizer: ClosureExpr }>
  | Node<{ readonly kind: "retry"; readonly job: Expr; readonly times: number }>
  | Node<{ readonly kind: "timeout"; readonly job: Expr; readonly durationMs: Expr }>
  | Node<{ readonly kind: "repeat"; readonly job: Expr; readonly options: Expr | null }>
  | Node<{ readonly kind: "sleep"; readonly durationMs: Expr }>
  | Node<{ readonly kind: "now" }>
  | Node<{ readonly kind: "log"; readonly message: Expr; readonly level: LogLevel; readonly fields: Expr | null }>
  | Node<{ readonly kind: "random" }>
  | Node<{ readonly kind: "random-int"; readonly min: Expr; readonly max: Expr }>
  | Node<{ readonly kind: "uninterruptible"; readonly job: Expr }>
  | Node<{ readonly kind: "provide"; readonly provider: Expr; readonly job: Expr }>
  | Node<{
      readonly kind: "binary";
      readonly operator: "+" | "-" | "*" | "/" | "%" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "&&" | "||";
      readonly left: Expr;
      readonly right: Expr;
    }>;

export type TypeDecl = {
  readonly kind: "type";
  readonly id: TypeId;
  readonly name: string;
  readonly definition:
    | { readonly kind: "alias"; readonly type: Type }
    | {
      readonly kind: "nominal";
      readonly base: Type;
      readonly tagged?: true;
      readonly sealed?: true;
    };
  readonly predicate?: Predicate;
  readonly opaque?: boolean;
  readonly span: Span;
};

export type ErrorDecl = {
  readonly kind: "error";
  readonly id: ErrorId;
  readonly name: string;
  readonly fields: readonly Field[];
  readonly span: Span;
};

export type MethodDecl = {
  readonly id: CapabilityId;
  readonly name: string;
  readonly type: FunctionType;
  readonly borrows?: readonly boolean[];
  readonly span: Span;
};

export type ServiceDecl = {
  readonly kind: "service";
  readonly id: ServiceId;
  readonly name: string;
  readonly methods: readonly MethodDecl[];
  readonly span: Span;
};

/** Which parts of a function contract are closed. A closed set bounds the body from above. An open set equals the body set. */
export type WrittenParts = {
  readonly result: boolean;
  readonly fails: boolean;
  readonly uses: boolean;
};

export type FunctionDecl = {
  readonly kind: "function";
  readonly id: ValueId;
  readonly name: string;
  readonly parameters: readonly Parameter[];
  /** The callable interface. Its effects can exceed the inferred body effects. */
  readonly type: FunctionType;
  readonly written: WrittenParts;
  /** Parameter identities validated in declaration order before the body. */
  readonly entryValidation?: readonly LocalId[];
  readonly body: Expr;
  readonly span: Span;
};

export type ConstantDecl = {
  readonly kind: "constant";
  readonly id: ValueId;
  readonly name: string;
  readonly type: Type;
  readonly value: Expr;
  readonly span: Span;
};

export type Declaration = TypeDecl | ErrorDecl | ServiceDecl | FunctionDecl | ConstantDecl;
export type DeclarationId = TypeId | ErrorId | ServiceId | ValueId;

export type Import = {
  readonly module: string;
  /** These bindings select public names. Other declarations supply transitive type information. */
  readonly bindings: readonly { readonly name: string; readonly target: DeclarationId }[];
  readonly exports: readonly DeclarationId[];
  /** A module interface supplies these types before body checking. */
  readonly values: readonly { readonly id: ValueId; readonly name: string; readonly type: Type }[];
  readonly types: readonly TypeDecl[];
  readonly errors: readonly ErrorDecl[];
  readonly services: readonly ServiceDecl[];
};

export type ModuleIR = {
  readonly format: "light-functional-ir";
  readonly version: 10;
  readonly module: string;
  /** A validator also receives immutable source texts keyed by these identifiers. */
  readonly sources: readonly string[];
  readonly imports: readonly Import[];
  readonly declarations: readonly Declaration[];
  readonly exports: readonly DeclarationId[];
};

export type Diagnostic = {
  readonly code: string;
  readonly message: string;
  readonly span: Span;
};
