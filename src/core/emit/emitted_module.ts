// The data that the emitter produces for one module. spans.ts reads it.

import type { HostAssertionData, SpanRecord } from "./doc.ts";

/**
 * The generated range of one host assertion constant: the whole statement
 * `const UsersLive$host: Layer.Layer<Users> = UsersLive;`. A `deno check` error
 * on this range is a host-boundary error.
 */
export interface HostAssertionRecord extends HostAssertionData {
  /** Offsets in UTF-16 code units of the generated text. The end is exclusive. */
  readonly start: number;
  readonly end: number;
}

export interface EmittedModule {
  readonly module: string;
  /** The generated file, relative to the project root: `users.ts` for `users.eff`. */
  readonly path: string;
  readonly text: string;
  /** Generated ranges of the printed declarations and expressions. `buildSpanTable` turns them into the span table. */
  readonly spans: readonly SpanRecord[];
  /** Generated ranges of the host assertion constants, in the order of the output. */
  readonly hostAssertions: readonly HostAssertionRecord[];
}
