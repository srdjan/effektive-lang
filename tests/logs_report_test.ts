// Tests for scripts/logs_report.ts on the logs in fixtures/logs/.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildReport,
  type LogFile,
  parseArgs,
  parseSession,
} from "../scripts/logs_report.ts";

const DIR = new URL("../fixtures/logs/", import.meta.url);
const NOW = new Date("2026-10-26T12:00:00.000Z");
const HOUR = 3_600_000;

function load(): LogFile[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.name.endsWith(".jsonl"))
    .map((e) => e.name)
    .sort()
    .map((name) =>
      parseSession(Deno.readTextFileSync(new URL(name, DIR)), name)
    );
}

const report = (sinceMs = 6 * HOUR, files = load()) =>
  buildReport(files, { now: NOW, sinceMs });

/** The text of one `## ` section. */
function section(text: string, title: string): string {
  const start = text.indexOf(`## ${title}\n`);
  assert(start >= 0, `no section ${title}`);
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

Deno.test("sessions: one row per surface and build, and the old session drops out", () => {
  const sessions = section(report(), "Sessions");
  assertStringIncludes(sessions, "| cli | 0.10.3 | 3 |");
  assertStringIncludes(sessions, "| lsp | 0.10.3 | 1 |");
  assertStringIncludes(sessions, "| playground | 0.10.3 | 1 |");
  assertStringIncludes(sessions, "Events from 2026-10-26T08:00:00.000Z");
  assertStringIncludes(
    section(report(30 * 24 * HOUR), "Sessions"),
    "| cli | 0.10.3 | 4 |",
  );
});

Deno.test("broken behavior: names the session and seq of each seeded item", () => {
  const broken = section(report(), "Broken behavior");
  assertStringIncludes(
    broken,
    "`4e5f6071` seq 22: language server error -32603 (internal error): Cannot read",
  );
  assertStringIncludes(broken, "-32602 (invalid params)");
  assertStringIncludes(broken, "`4e5f6071` seq 20: bad frame bad-json");
  assertStringIncludes(broken, "`4e5f6071` seq 27: language server error text");
  assertStringIncludes(
    broken,
    "`5f607182` seq 18: playground error compile-failed",
  );
  assertStringIncludes(broken, "`3d4e5f60` seq 1: CLI error");
  assertStringIncludes(broken, "`3d4e5f60` seq 2: CLI exit 2");
  assertStringIncludes(broken, "-000000000004.jsonl` line 2: unparsable line");
  assertStringIncludes(broken, "ended without an end event: 1.");
});

Deno.test("latency: percentiles, diagnostics latency, and the budget marks", () => {
  const latency = section(report(), "Latency");
  assertStringIncludes(latency, "| cli.phase build | 2 | 51.8 | 86.5 |");
  assertStringIncludes(
    latency,
    "| lsp.timing textDocument/hover | 2 | 3 | 4 |",
  );
  assertStringIncludes(
    latency,
    "| lsp diagnostics (edit to publish) | 3 | 40 | 40 |",
  );
  assertStringIncludes(latency, "| pg.compile | 6 | 29.9 | 130.5 |");
  assertStringIncludes(
    latency,
    "lsp diagnostics (edit to publish): p90 40 ms is within",
  );
  assertStringIncludes(latency, "pg.compile: p90 130.5 ms is over");
});

Deno.test("friction: transient codes, fix times, hover misses, stale time, clicks", () => {
  const friction = section(report(), "Friction");
  assertStringIncludes(friction, "Transient appearances: 3.");
  assertStringIncludes(friction, "| syntax/008 | 2 |");
  assertStringIncludes(friction, "| unknown-name/001 | 1 |");
  // 805 ms and 10000 ms in the playground, 310 ms in the language server.
  assertStringIncludes(friction, "Fixes: 3, p50 805 ms, p90 10000 ms.");
  assertStringIncludes(
    friction,
    "Playground: 1 by pointer and 1 by cursor, of 3 hovers. Language server: 1 of 2",
  );
  assertStringIncludes(friction, "Spans: 2, 10805 ms in total.");
  assertStringIncludes(friction, "| unknown-name/001 | 1 |");
  assertStringIncludes(friction, "| typescript | 2 |");
  assertStringIncludes(friction, "| source | 1 |");
});

Deno.test("outcomes: compiles, the last saving label, and files written", () => {
  const outcomes = section(report(), "Outcomes");
  assertStringIncludes(outcomes, "| playground | 6 |");
  assertStringIncludes(outcomes, "| lsp | 3 |");
  assertStringIncludes(
    outcomes,
    "| users.eff | 28% fewer characters than Effect-TS |",
  );
  assertStringIncludes(outcomes, "Files: 2, 2000 bytes.");
});

Deno.test("an empty period gives the None lines and counts a missing folder", () => {
  const text = buildReport([], {
    now: NOW,
    sinceMs: HOUR,
    notes: ["Folder not found: nowhere"],
  });
  assertStringIncludes(text, "Folder not found: nowhere");
  for (
    const title of [
      "Sessions",
      "Broken behavior",
      "Latency",
      "Friction",
      "Outcomes",
    ]
  ) {
    assertStringIncludes(section(text, title), "None in this period.");
  }
});

Deno.test("a burst gap of 1000 ms or more ends the burst", () => {
  const event = (kind: string, ms: number, data: unknown) =>
    JSON.stringify({
      v: 1,
      t: new Date(NOW.getTime() - HOUR + ms).toISOString(),
      ms,
      surface: "playground",
      session: "s",
      seq: ms,
      build: "b",
      kind,
      data,
    });
  const compile = (ms: number, code: string[]) =>
    event("pg.compile", ms, {
      path: "a.eff",
      ms: 1,
      diagnostics: code.map((c) => ({ code: c })),
      stale: false,
      saving: "",
    });
  const edit = (ms: number) => event("pg.edit", ms, { path: "a.eff" });
  // Two edits 1000 ms apart are two bursts, so E1 is not transient.
  const lines = [edit(0), compile(1, ["E1"]), edit(1000), compile(1001, [])];
  const text = lines.join("\n");
  const frictionOf = (t: string) =>
    section(
      buildReport([parseSession(t, "x.jsonl")], {
        now: NOW,
        sinceMs: 2 * HOUR,
      }),
      "Friction",
    );
  assertStringIncludes(frictionOf(text), "None in this period.");
  const close = [edit(0), compile(1, ["E1"]), edit(999), compile(1000, [])];
  assertStringIncludes(
    frictionOf(close.join("\n")),
    "Transient appearances: 1.",
  );
});

Deno.test("parseArgs: defaults, a window, and usage errors", () => {
  assertEquals(parseArgs([]), {
    ok: true,
    value: { sinceMs: 24 * HOUR, folders: ["playground/.effektive/logs/"] },
  });
  assertEquals(parseArgs(["--since", "30m", "a", "b"]), {
    ok: true,
    value: { sinceMs: 30 * 60_000, folders: ["a", "b"] },
  });
  assertEquals(parseArgs(["--since", "2d"]).ok, true);
  for (
    const bad of [["--since", "x"], ["--since"], ["--since", "0h"], ["--nope"]]
  ) {
    assertEquals(parseArgs(bad).ok, false, bad.join(" "));
  }
});
