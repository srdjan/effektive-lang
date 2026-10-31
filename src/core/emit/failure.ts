/** Thrown inside the emitter only. `emitModule` turns it into an `EmitError`. */
export class EmitFailure extends Error {}

export function internal(message: string): EmitFailure {
  return new EmitFailure(message);
}
