import { assertEquals } from "@std/assert";
import {
  type Envelope,
  isAnyKind,
  isKind,
  parseEnvelope,
  parseSessionFileName,
  sessionFileName,
} from "../src/host/log_schema.ts";

const SESSION = "0a1b2c3d-0000-4000-8000-000000000001";

const envelope = {
  v: 1,
  t: "2026-10-26T15:39:28.123Z",
  ms: 1.5,
  surface: "playground",
  session: SESSION,
  seq: 0,
  build: "0.10.3",
  kind: "pg.end",
  data: {},
};

Deno.test("sessionFileName writes the surface, the UTC day, and the session", () => {
  assertEquals(
    sessionFileName("lsp", new Date("2026-10-26T23:59:59Z"), SESSION),
    `lsp-20261026-${SESSION}.jsonl`,
  );
});

Deno.test("parseSessionFileName reads the parts of a session file name", () => {
  assertEquals(parseSessionFileName(`cli-20261026-${SESSION}.jsonl`), {
    surface: "cli",
    day: "20261026",
    session: SESSION,
  });
});

Deno.test("parseSessionFileName refuses every other name", () => {
  const refused = [
    `other-20261026-${SESSION}.jsonl`,
    `cli-2026102-${SESSION}.jsonl`,
    `cli-20261026-${SESSION}.json`,
    `cli-20261026-${SESSION.toUpperCase()}.jsonl`,
    `../cli-20261026-${SESSION}.jsonl`,
    "cli-20261026-0a1b2c3d-0000-4000-8000-00000000000g.jsonl",
    "",
  ].map((name) => parseSessionFileName(name));
  assertEquals(refused, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

Deno.test("parseEnvelope browser policy keeps the envelope fields in order", () => {
  const parsed = parseEnvelope({ ...envelope, extra: 1 }, "browser");
  assertEquals(
    JSON.stringify(parsed),
    JSON.stringify(envelope),
  );
});

Deno.test("parseEnvelope browser policy refuses a bad envelope", () => {
  const bad = [
    { ...envelope, surface: "cli" },
    { ...envelope, kind: "cli.end" },
    { ...envelope, session: "x" },
    { ...envelope, seq: -1 },
    { ...envelope, seq: 1.5 },
    { ...envelope, ms: Infinity },
    { ...envelope, v: 2 },
    { v: 1, t: "x", ms: 0, surface: "playground", session: SESSION },
    [],
    null,
  ].map((value) => parseEnvelope(value, "browser"));
  assertEquals(bad, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

Deno.test("parseEnvelope replay policy keeps the value and any kind or surface", () => {
  const old = {
    v: 1,
    t: "2026-10-26T15:39:28.123Z",
    ms: 0,
    surface: "lsp",
    session: "short",
    seq: 0.5,
    build: "1",
    kind: "lsp.unknown",
    note: "kept",
  };
  assertEquals(parseEnvelope(old, "replay"), old as unknown as Envelope);
});

Deno.test("parseEnvelope replay policy refuses a bad time, surface, or type", () => {
  const bad = [
    { ...envelope, t: "not a time" },
    { ...envelope, surface: "web" },
    { ...envelope, ms: "1" },
    { ...envelope, kind: 3 },
    "text",
  ].map((value) => parseEnvelope(value, "replay"));
  assertEquals(bad, [undefined, undefined, undefined, undefined, undefined]);
});

Deno.test("isKind and isAnyKind compare the kind name", () => {
  assertEquals(
    [
      isKind({ kind: "cli.end" }, "cli.end"),
      isKind({ kind: "cli.end" }, "cli.start"),
      isAnyKind({ kind: "pg.end" }, new Set(["pg.end", "pg.start"])),
      isAnyKind({ kind: "x" }, new Set(["pg.end"])),
    ],
    [true, false, true, false],
  );
});
