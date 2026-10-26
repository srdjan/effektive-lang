// The pure parts of the playground replay (plan LG6): the steps of a logged
// session, the application of an edit to a text, and the timed player. The
// page and `scripts/logs_replay.ts` share this file. It has no DOM code.

import { isRecord } from "../../src/core/mod.ts";
import type { EditChange } from "./events.ts";

/** The longest single wait of the player, in milliseconds. */
export const MAX_WAIT_MS = 2000;

/** One action of a logged session that the player runs in the editor. */
export type ReplayStep =
  | { readonly tag: "select"; readonly path: string; readonly waitMs: number }
  | {
    readonly tag: "edit";
    readonly path: string;
    readonly changes: readonly EditChange[];
    readonly waitMs: number;
  };

/** The changes of a `pg.edit` event, or undefined when `data` has another shape. */
export function editChangesOf(data: unknown): EditChange[] | undefined {
  if (!isRecord(data) || !Array.isArray(data.changes)) return undefined;
  const changes: EditChange[] = [];
  for (const change of data.changes) {
    if (
      !isRecord(change) || typeof change.from !== "number" ||
      typeof change.to !== "number" || typeof change.insert !== "string"
    ) return undefined;
    changes.push({ from: change.from, to: change.to, insert: change.insert });
  }
  return changes;
}

/**
 * The text after an edit. Offsets index the text before the edit, so the
 * changes apply from the last to the first.
 */
export function applyChanges(
  text: string,
  changes: readonly EditChange[],
): string {
  let result = text;
  for (let i = changes.length - 1; i >= 0; i--) {
    const { from, to, insert } = changes[i];
    result = result.slice(0, from) + insert + result.slice(to);
  }
  return result;
}

/**
 * The steps of a session file (one JSON envelope per line). A line or an event
 * of another shape is skipped. A step waits for the recorded gap to the step
 * before it, capped at `MAX_WAIT_MS`.
 */
export function stepsOf(text: string): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let previous = 0;
  for (const line of text.split("\n")) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      !isRecord(event) || typeof event.ms !== "number" ||
      !isRecord(event.data) || typeof event.data.path !== "string"
    ) continue;
    const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, event.ms - previous));
    const path = event.data.path;
    if (event.kind === "pg.select") {
      steps.push({ tag: "select", path, waitMs });
    } else if (event.kind === "pg.edit") {
      const changes = editChangesOf(event.data);
      if (changes === undefined) continue;
      steps.push({ tag: "edit", path, changes, waitMs });
    } else continue;
    previous = event.ms;
  }
  return steps;
}

const sleepFor = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the steps in order, each after its wait. `sleep` is a seam for tests. */
export async function play(
  steps: readonly ReplayStep[],
  run: (step: ReplayStep) => void,
  sleep: (ms: number) => Promise<void> = sleepFor,
): Promise<void> {
  for (const step of steps) {
    await sleep(step.waitMs);
    run(step);
  }
}
