// The side tables of body checking. For each declaration body
// the checker records, per syntax node, the type, the active failure and
// requirement sets, and the execution mode (see `effect_set.ts`). It also records the facts that
// lowering needs and cannot read from the tree alone: which kind of
// call a call node is, which pattern kind a pattern node is, and so on.

import type {
  CapabilityId,
  ErrorId,
  Expr,
  FunctionType,
  LocalId,
  LogLevel,
  RefinementProof,
  ServiceId,
  TypeId,
  ValueId,
  WrittenParts,
} from "./ir.ts";
import type { EffectSet } from "./effect_set.ts";
import type { BuiltinInstanceName } from "./ids.ts";
import type { NodeId } from "./syntax.ts";
import type { TypeRef } from "./types.ts";

/** What the checker records for one syntax node. */
export interface NodeInfo extends EffectSet {
  readonly type: TypeRef;
}

/** What a pattern node means, for lowering. */
export type PatternFact =
  | { readonly kind: "wildcard" }
  | {
    readonly kind: "literal";
    readonly value: string | number | boolean | null;
  }
  | {
    readonly kind: "duration";
    readonly millis: number;
    readonly text: string;
  }
  | { readonly kind: "none" }
  /** A bare name arm of a nullable match: it matches every value except null. */
  | { readonly kind: "bind"; readonly binding: LocalId | undefined }
  | { readonly kind: "some"; readonly binding: LocalId | undefined }
  | {
    readonly kind: "error";
    readonly error: ErrorId;
    readonly binding: LocalId | undefined;
  }
  | {
    readonly kind: "tagged";
    readonly tagged: TypeId;
    readonly binding: LocalId | undefined;
  }
  | {
    readonly kind: "tag";
    readonly field: string;
    readonly value: string;
    readonly binding: LocalId | null;
  }
  /** A pattern that a diagnostic already rejected. */
  | { readonly kind: "invalid" };

export interface ArrowParameterFact {
  readonly id: LocalId | undefined;
  readonly name: string;
  readonly type: TypeRef;
}

/** What a node means, for lowering. The key is the syntax node id. */
export type NodeFact =
  | {
    readonly kind: "record-binding";
    readonly captured: ArrowParameterFact;
    readonly fields: readonly {
      readonly name: string;
      readonly binding: ArrowParameterFact;
      readonly label: NodeId;
      readonly local: NodeId;
    }[];
  }
  | {
    readonly kind: "option-fallback";
    /** Which left operand the fallback unwraps: an Option or a nullable union. */
    readonly subject: "option" | "nullable";
    readonly binding: ArrowParameterFact;
  }
  /** An ordinary call of a function value. Also a pipeline stage that calls one. */
  | { readonly kind: "call" }
  /** A service operation: `S.m(args)` or a stage `x |> S.m`. */
  | { readonly kind: "perform"; readonly capability: CapabilityId }
  | { readonly kind: "error-construction"; readonly error: ErrorId }
  /** A constructor call or a record literal at a type with identity. */
  | { readonly kind: "identity-construction"; readonly identity: TypeId }
  | { readonly kind: "some" }
  | { readonly kind: "none" }
  | { readonly kind: "fail" }
  | { readonly kind: "retry"; readonly times: number | undefined }
  | { readonly kind: "provide"; readonly provider: ValueId | undefined }
  | { readonly kind: "defer" }
  | { readonly kind: "timeout" }
  | { readonly kind: "repeat"; readonly options: boolean }
  | { readonly kind: "sleep" }
  | { readonly kind: "now" }
  | {
    readonly kind: "log";
    readonly level: LogLevel | undefined;
    /** The label of the `fields` option in the options record, when it is written. */
    readonly fields: string | undefined;
  }
  | { readonly kind: "random" }
  | { readonly kind: "random-int" }
  | { readonly kind: "uninterruptible" }
  | { readonly kind: "run" }
  | { readonly kind: "scoped" | "fork-scoped" }
  | { readonly kind: "unfold" }
  | {
    readonly kind: "map-effect";
    readonly concurrency: number | "unbounded" | undefined;
  }
  | { readonly kind: "map-stream" }
  | { readonly kind: "sink-for-each" }
  | { readonly kind: "take-sink"; readonly count: number | undefined }
  | { readonly kind: "transduce-stream" }
  | { readonly kind: "run-stream" }
  | { readonly kind: "buffer-stream"; readonly capacity: number | undefined }
  | { readonly kind: "race" | "race-all" }
  | { readonly kind: "make-ref" | "get-ref" | "set-ref" | "update-ref" }
  | { readonly kind: "layer"; readonly service: ServiceId | undefined }
  | { readonly kind: "merge-layers" }
  | { readonly kind: "retry-schedule" | "retry-with-schedule" }
  | {
    readonly kind: "schema";
    /** The IR operations, and the three that lower to their own kinds. */
    readonly op:
      | Extract<Expr, { kind: "schema" }>["op"]
      | "decode"
      | "encode"
      | "make";
    /**
     * The options argument of a default-key builtin. The IR drops the option
     * `on`, because the operation already records its value. `on` is the
     * label of that option.
     */
    readonly options: { readonly on: string } | undefined;
  }
  /**
   * A bracket literal, classified by its checked contextual type. A literal
   * with a spread has `concat`, the closed type of the internal instance
   * `concat`: one array parameter for each child.
   */
  | {
    readonly kind: "list";
    readonly shape: "array" | "tuple";
    readonly concat?: FunctionType;
  }
  /** A builtin instance with its closed function type. */
  | {
    readonly kind: "builtin";
    readonly name: BuiltinInstanceName;
    readonly ir: FunctionType;
  }
  /** A field read. `optional` is true when the field is optional and the read is `Option<T>`. */
  | {
    readonly kind: "field";
    readonly name: string;
    readonly optional: boolean;
  }
  | {
    readonly kind: "arrow";
    readonly parameters: readonly ArrowParameterFact[];
    readonly written: WrittenParts;
  }
  /** A block `const`. */
  | {
    readonly kind: "binding";
    readonly id: LocalId | undefined;
    readonly type: TypeRef;
  }
  | { readonly kind: "pattern"; readonly pattern: PatternFact }
  /** A `try` finally clause. The binding is the outcome parameter, when written. */
  | {
    readonly kind: "finalizer";
    readonly binding: ArrowParameterFact | undefined;
    /** The effects of the block and its handlers, without the finalizer. */
    readonly protectedSet: EffectSet;
  }
  | {
    readonly kind: "handler";
    readonly error: ErrorId | undefined;
    /** True for the `Defect` arm, which names no error. */
    readonly defect?: true;
    readonly binding: LocalId | undefined;
  };

export interface BodyTable {
  readonly declaration: ValueId;
  /** Syntax node id to type, sets, and mode. */
  readonly info: Map<NodeId, NodeInfo>;
  readonly proofs: Map<NodeId, readonly RefinementProof[]>;
  /** Syntax node id to what lowering needs. */
  readonly facts: Map<NodeId, NodeFact>;
  /** The type of each parameter, block binding, and pattern binding. */
  readonly locals: Map<LocalId, TypeRef>;
  /**
   * The sets of a pipeline stage without its left value. A stage has an entry
   * only when its left value is not quiet. The stage's own `info` includes the
   * left value, but the lowering evaluates the left value in its own binding.
   */
  readonly stageSets: Map<NodeId, EffectSet>;
}

export function newBodyTable(declaration: ValueId): BodyTable {
  return {
    declaration,
    info: new Map(),
    proofs: new Map(),
    facts: new Map(),
    locals: new Map(),
    stageSets: new Map(),
  };
}
