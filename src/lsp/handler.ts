import type { HostFs } from "../host/io.ts";
import type { Result } from "../core/mod.ts";
import type { GeneratedTypeScriptResult } from "./protocol.ts";
import type { LocatedModule } from "./generated_texts.ts";
import type { ProjectSet } from "./projects.ts";

/** What a handler reads of the generated TypeScript of the subscribed modules. */
export interface GeneratedSource {
  /**
   * Answers `effektive/generatedTypeScript` and subscribes the URI of a
   * module. `found` is the project of the URI, or undefined when it has none.
   */
  request(
    uri: string,
    found: LocatedModule | undefined,
  ): GeneratedTypeScriptResult | null;
}

/** What a handler can read and do. */
export interface ServerContext {
  readonly projects: ProjectSet;
  readonly fs: HostFs;
  /** The generated TypeScript of the subscribed modules. */
  readonly generated: GeneratedSource;
  /** The memory use of the process, in bytes. */
  memory(): { readonly rss: number; readonly heapUsed: number };
}

/** A failed request: the code and the message of the error response. */
export interface RequestFailure {
  readonly code: number;
  readonly message: string;
}

export type RequestHandler = (
  params: unknown,
  ctx: ServerContext,
) => Result<unknown, RequestFailure>;
