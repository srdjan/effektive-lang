/** Expected compiler failures are data. */
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };
