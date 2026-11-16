// The port types that io.ts and log.ts both name. Neither file imports the other.

export type FileFailure = {
  readonly message: string;
};

export interface EventLog {
  append(kind: string, data: unknown): undefined;
  /** Stores the text under its SHA-256 hex hash, and returns the hash. */
  blob(text: string): string;
}
