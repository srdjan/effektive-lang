// Fast tests of the session log of the command-line tool. They run `main` in
// process with the memory io, whose `openLog` returns a memory log.

import { assert, assertEquals } from "@std/assert";
import { main } from "../src/cli/main.ts";
import { FIXTURES } from "./helpers.ts";
import { memoryIo } from "./cli_helpers.ts";

const ROOT = "/proj";
const ERROR_SOURCE = Deno.readTextFileSync(
  new URL("errors/type-mismatch-argument-count.eff", FIXTURES),
);

function project(): Record<string, string> {
  return {
    [`${ROOT}/effektive.json`]: "{}",
    [`${ROOT}/m.eff`]: ERROR_SOURCE,
    [`${ROOT}/ok.eff`]: "type Cents = int\n",
  };
}

Deno.test("check logs start, inputs, phases, diagnostics, and end in order", async () => {
  const m = memoryIo(project());
  const code = await main(["check", ROOT], m.io);
  assertEquals(code, 1);
  assertEquals(m.logs.length, 1);
  const log = m.logs[0];
  assertEquals(
    log.events.map((e) => e.kind),
    [
      "cli.start",
      "cli.input",
      "cli.input",
      "cli.input",
      "cli.phase",
      "cli.phase",
      "cli.diagnostics",
      "cli.end",
    ],
  );
  const kinds = log.events.map((e) => e.kind);
  assertEquals(kinds.filter((k) => k === "cli.phase").length, 2);
  const data = (kind: string, n = 0) =>
    log.events.filter((e) => e.kind === kind)[n].data as Record<
      string,
      unknown
    >;
  assertEquals(data("cli.start"), {
    args: ["check", ROOT],
    command: "check",
    root: ROOT,
  });
  assertEquals(data("cli.phase", 0).name, "sync");
  assertEquals(data("cli.phase", 1).name, "build");
  assertEquals(data("cli.end").code, 1);
});

Deno.test("cli.input covers the project file and each source, with blobs", async () => {
  const m = memoryIo(project());
  await main(["check", ROOT], m.io);
  const log = m.logs[0];
  const inputs = log.events.filter((e) => e.kind === "cli.input").map((e) =>
    e.data as { path: string; hash: string }
  );
  assertEquals(inputs.map((i) => i.path).sort(), [
    "effektive.json",
    "m.eff",
    "ok.eff",
  ]);
  for (const input of inputs) {
    assertEquals(
      log.blobs.get(input.hash),
      m.files.get(`${ROOT}/${input.path}`),
    );
  }
});

Deno.test("cli.diagnostics carries the code, path, range, and message", async () => {
  const m = memoryIo(project());
  await main(["check", ROOT], m.io);
  const event = m.logs[0].events.find((e) => e.kind === "cli.diagnostics");
  const items = (event?.data as { items: Record<string, unknown>[] }).items;
  assertEquals(items.length, 1);
  assertEquals(items[0].code, "type-mismatch/004");
  assertEquals(items[0].path, "m.eff");
  assertEquals(items[0].source, "effektive");
  assertEquals(items[0].start, { line: 5, column: 3 });
  assert(typeof items[0].end === "object");
  assert(String(items[0].message).includes("argument"));
});

Deno.test("build logs one cli.output per written file, with a hash and no blob", async () => {
  const m = memoryIo({
    [`${ROOT}/effektive.json`]: "{}",
    [`${ROOT}/ok.eff`]: "type Cents = int\n",
  });
  assertEquals(await main(["build", ROOT], m.io), 0);
  const log = m.logs[0];
  const outputs = log.events.filter((e) => e.kind === "cli.output").map((e) =>
    e.data as { path: string; bytes: number; hash: string }
  );
  assertEquals(outputs.map((o) => o.path).sort(), ["ok.ts", "ok.ts.map"]);
  for (const output of outputs) {
    assertEquals(
      output.bytes,
      new TextEncoder().encode(m.files.get(`${ROOT}/${output.path}`)).length,
    );
    assertEquals(log.blobs.has(output.hash), false);
  }
});

Deno.test("--no-log opens no log, and a usage error opens none either", async () => {
  const quiet = memoryIo(project());
  await main(["check", ROOT, "--no-log"], quiet.io);
  assertEquals(quiet.logs.length, 0);
  const bad = memoryIo(project());
  assertEquals(await main(["check", "--nope"], bad.io), 2);
  assertEquals(await main(["check", "/missing"], bad.io), 2);
  assertEquals(await main(["--help"], bad.io), 0);
  assertEquals(bad.logs.length, 0);
});

Deno.test("a configuration error logs cli.error and cli.end", async () => {
  const m = memoryIo({ [`${ROOT}/effektive.json`]: "{ not json" });
  assertEquals(await main(["check", ROOT], m.io), 2);
  const kinds = m.logs[0].events.map((e) => e.kind);
  assertEquals(kinds.at(-2), "cli.error");
  assertEquals(kinds.at(-1), "cli.end");
});

Deno.test("watch logs the changed paths of each batch and the changed inputs", async () => {
  const m = memoryIo({
    [`${ROOT}/effektive.json`]: "{}",
    [`${ROOT}/ok.eff`]: "type Cents = int\n",
  });
  m.script = [() => {
    m.files.set(`${ROOT}/ok.eff`, "type Cents = string\n");
    return ["ok.eff"];
  }];
  assertEquals(await main(["watch", ROOT], m.io), 0);
  const events = m.logs[0].events;
  const change = events.find((e) => e.kind === "cli.change");
  assertEquals(change?.data, { paths: ["ok.eff"] });
  const inputs = events.filter((e) => e.kind === "cli.input").map((e) =>
    (e.data as { path: string }).path
  );
  assertEquals(inputs, ["effektive.json", "ok.eff", "ok.eff"]);
  assertEquals(events.at(-1)?.kind, "cli.end");
});

Deno.test("build --tsc logs the exit code of deno check", async () => {
  const m = memoryIo({
    [`${ROOT}/effektive.json`]: "{}",
    [`${ROOT}/ok.eff`]: "type Cents = int\n",
  });
  assertEquals(await main(["build", ROOT, "--tsc"], m.io), 0);
  const tsc = m.logs[0].events.find((e) => e.kind === "cli.tsc");
  assertEquals((tsc?.data as { code: number }).code, 0);
});
