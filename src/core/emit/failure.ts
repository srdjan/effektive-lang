import { invariantFailure, type InvariantMessage } from "../source.ts";

/** `emitModule` returns an invariant failure as an `EmitError`. */
export function internal(message: InvariantMessage): never {
  return invariantFailure("emit", message);
}
