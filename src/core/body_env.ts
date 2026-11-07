import type { CapabilityId, ValueId } from "./ir.ts";
import type { TypeEnv } from "./signatures.ts";
import type { TypeRef } from "./types.ts";

export interface BodyEnv {
  readonly env: TypeEnv;
  /** The type of a module-level value, local or imported. The error type when unknown. */
  readonly values: (id: ValueId) => TypeRef;
  /** The function type of a service method. The error type when unknown. */
  readonly methodType: (capability: CapabilityId) => TypeRef;
  readonly proofBudget: ProofBudget;
}

export interface ProofBudget {
  remaining: number;
}
