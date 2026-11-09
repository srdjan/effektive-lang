// Tests for the playground compile facade: the examples, an edit with an error,
// stale output and its repair, a cross-file edit, hover, a configuration error,
// an internal error, and the clock.

import { TypeScriptOutputs } from "../src/core/typescript.ts";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Program } from "../src/core/frontend.ts";
import {
  createPlayground,
  type Playground,
  type PlaygroundResult,
  type ProgramPort,
} from "../playground/src/compile.ts";
import { exampleFiles, offsetOf } from "./helpers.ts";

const FILES = exampleFiles();
const SOURCE_PATHS = [
  "collections.eff",
  "host/providers.effi",
  "log.eff",
  "main.eff",
  "pay.eff",
  "users-service.eff",
  "users.eff",
];
const BAD_USERS = FILES["users.eff"] +
  'export const limit: Int = 3 + "x"\ntype Int = int\n';

function start(): { pg: Playground; first: PlaygroundResult } {
  const pg = createPlayground(FILES, { now: () => 0 });
  const first = pg.start();
  assert(first.ok);
  return { pg, first: first.value };
}

function okOf(
  result: ReturnType<Playground["update"]>,
): PlaygroundResult {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

Deno.test("the examples compile with no diagnostics and seven outputs, one for the host file", () => {
  const { first } = start();
  for (const diagnostics of Object.values(first.diagnostics)) {
    assertEquals(diagnostics, []);
  }
  assertEquals(Object.keys(first.outputs).sort(), SOURCE_PATHS);
  for (const path of SOURCE_PATHS) {
    const output = first.outputs[path];
    assert(output !== null);
    assertEquals(output.stale, false);
    assert(output.text.includes("Generated from"));
  }
  assertEquals(first.diagnostics["host/providers.effi"], []);
});

Deno.test("an update before start sends every file", () => {
  const pg = createPlayground(FILES, { now: () => 0 });
  const result = okOf(pg.update("users.eff", FILES["users.eff"]));
  assertEquals(Object.keys(result.outputs).sort(), SOURCE_PATHS);
});

Deno.test("the first call sends every file and later calls send one file", () => {
  const sets: string[][] = [];
  const real = new Program("");
  const program: ProgramPort = {
    update(changes) {
      const set = changes.set instanceof Map
        ? [...changes.set.keys()]
        : Object.keys(changes.set ?? {});
      sets.push(set.sort());
      return real.update(changes);
    },
  };
  const pg = createPlayground(FILES, { now: () => 0, program });
  assert(pg.start().ok);
  assert(pg.update("users.eff", FILES["users.eff"]).ok);
  assertEquals(sets.length, 2);
  assertEquals(sets[0], Object.keys(FILES).sort());
  assertEquals(sets[1], ["users.eff"]);
});

Deno.test("an error gives offsets over the right text and a stale output", () => {
  const { pg, first } = start();
  const oldText = first.outputs["users.eff"]?.text;
  assert(oldText !== undefined);
  const result = okOf(pg.update("users.eff", BAD_USERS));
  const diagnostics = result.diagnostics["users.eff"];
  assertEquals(diagnostics.length, 1);
  const d = diagnostics[0];
  assertEquals(d.severity, "error");
  assertEquals(d.code, "type-mismatch/007");
  assertEquals(BAD_USERS.slice(d.from, d.to), '3 + "x"');
  assertEquals(result.outputs["users.eff"], { text: oldText, stale: true });
  assertEquals(result.diagnostics["main.eff"], []);
});

Deno.test("a repair clears the diagnostic and the stale flag", () => {
  const { pg, first } = start();
  okOf(pg.update("users.eff", BAD_USERS));
  const result = okOf(pg.update("users.eff", FILES["users.eff"]));
  assertEquals(result.diagnostics["users.eff"], []);
  assertEquals(result.outputs["users.eff"], first.outputs["users.eff"]);
});

Deno.test("composite input provenance keeps the last good playground output", () => {
  const services = `
export type Int = int
export service Users { read(): Int }
export service Allowed { publish(input: { job: Effect<Int, never, Users.read> }): void }
`;
  const source = (job: string): string => `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const forward = (input: { job: Effect<Int, never, Users.read> }): void =>
  Allowed.publish({ job: ${job} })
`;
  const inherited = source("input.job");
  const local = source("defer(() => Users.read())");
  const pg = createPlayground({
    "effektive.json": "{}",
    "services.eff": services,
    "main.eff": inherited,
  }, { now: () => 0 });
  const first = pg.start();
  assert(first.ok, JSON.stringify(first));
  assertEquals(first.value.diagnostics["main.eff"], []);
  const lastGood = first.value.outputs["main.eff"];
  assert(lastGood !== null);
  assertEquals(lastGood.stale, false);

  const broken = okOf(pg.update("main.eff", local));
  assertEquals(broken.diagnostics["main.eff"].map((d) => d.code), [
    "requirement-contract/002",
  ]);
  assertEquals(broken.outputs["main.eff"], {
    text: lastGood.text,
    stale: true,
  });

  const repaired = okOf(pg.update("main.eff", inherited));
  assertEquals(repaired.diagnostics["main.eff"], []);
  assertEquals(repaired.outputs["main.eff"], lastGood);
});

Deno.test("an edit of the host interface file changes a diagnostic of main.eff", () => {
  const { pg } = start();
  const result = okOf(pg.update(
    "host/providers.effi",
    'import { Users } from "../users-service.eff"\n',
  ));
  assertEquals(result.diagnostics["host/providers.effi"], []);
  const main = result.diagnostics["main.eff"];
  assert(main.some((d) => d.code === "unknown-name/002"));
  const d = main.find((x) => x.code === "unknown-name/002");
  assert(d !== undefined);
  assertEquals(FILES["main.eff"].slice(d.from, d.to), "UsersLive");
  assertEquals(result.outputs["main.eff"]?.stale, true);
  const repaired = okOf(
    pg.update("host/providers.effi", FILES["host/providers.effi"]),
  );
  assertEquals(repaired.diagnostics["main.eff"], []);
  assertEquals(repaired.outputs["main.eff"]?.stale, false);
});

Deno.test("hover on rename gives the contract and the backend text", () => {
  const { pg } = start();
  const text = FILES["users.eff"];
  const at = offsetOf(text, "rename", 2);
  const hit = pg.hover("users.eff", at);
  assert(hit !== undefined);
  assertEquals(hit.from, offsetOf(text, "rename"));
  assertEquals(hit.to, offsetOf(text, "rename") + "rename".length);
  assertEquals(
    hit.contract,
    "rename(id: UserId, name: Name): User fails StoreUnavailable | UserMissing with Users.find | Users.save",
  );
  assertEquals(hit.backend, {
    tag: "type",
    text:
      "(id: UserId, name: Name): Effect.Effect<User, StoreUnavailable | UserMissing, Users>",
  });
  assertEquals(pg.hover("users.eff", 0), undefined);
});

Deno.test("hover after a breaking edit gives the unavailable backend", () => {
  const { pg } = start();
  okOf(pg.update("users.eff", BAD_USERS));
  const hit = pg.hover(
    "users.eff",
    offsetOf(FILES["users.eff"], "rename", 2),
  );
  assert(hit !== undefined);
  assertEquals(hit.backend, { tag: "unavailable" });
});

Deno.test("a broken effektive.json gives a config error and no hover", () => {
  const { pg } = start();
  const result = pg.update("effektive.json", "{ nope");
  assert(!result.ok);
  assertEquals(result.error.tag, "config");
  assert(result.error.message.includes("effektive.json"));
  assertEquals(pg.hover("users.eff", 10), undefined);
  const repaired = okOf(pg.update("effektive.json", FILES["effektive.json"]));
  assertEquals(repaired.outputs["users.eff"]?.stale, false);
  assertNotEquals(
    pg.hover("users.eff", offsetOf(FILES["users.eff"], "rename")),
    undefined,
  );
});

Deno.test("a program that throws gives an internal error and no hover", () => {
  let calls = 0;
  const real = new Program("");
  const program: ProgramPort = {
    update(changes) {
      calls++;
      if (calls === 2) throw new Error("boom");
      return real.update(changes);
    },
  };
  const pg = createPlayground(FILES, { now: () => 0, program });
  assert(pg.start().ok);
  assertNotEquals(
    pg.hover("users.eff", offsetOf(FILES["users.eff"], "rename")),
    undefined,
  );
  const result = pg.update("users.eff", FILES["users.eff"]);
  assert(!result.ok);
  assertEquals(result.error, { tag: "internal", message: "boom" });
  assertEquals(
    pg.hover("users.eff", offsetOf(FILES["users.eff"], "rename")),
    undefined,
  );
  assert(pg.update("users.eff", FILES["users.eff"]).ok);
});

Deno.test("a thrown value that is not an Error becomes the internal message", () => {
  const program: ProgramPort = {
    update() {
      throw "plain";
    },
  };
  const pg = createPlayground(FILES, { now: () => 0, program });
  const result = pg.start();
  assert(!result.ok);
  assertEquals(result.error, { tag: "internal", message: "plain" });
});

for (
  const phase of ["before update", "after update", "during emission"] as const
) {
  Deno.test(`an internal error ${phase} resends failed edits when another file changes`, () => {
    let calls = 0;
    const sets: ReadonlyMap<string, string>[] = [];
    const real = new Program("");
    const outputs = new TypeScriptOutputs();
    const emit = outputs.emitted.bind(outputs);
    const program: ProgramPort = {
      update(changes) {
        calls++;
        assert(changes.set instanceof Map);
        sets.push(changes.set);
        if (calls === 2 && phase === "before update") throw new Error("boom");
        const result = real.update(changes);
        if (calls === 2) {
          if (phase === "after update") throw new Error("boom");
          assert(result.ok);
          outputs.emitted = () => {
            outputs.emitted = emit;
            throw new Error("boom");
          };
        }
        return result;
      },
    };
    const pg = createPlayground(FILES, { now: () => 0, program, outputs });
    assert(pg.start().ok);
    const failed = pg.update("users.eff", BAD_USERS);
    assert(!failed.ok);
    assertEquals(failed.error, { tag: "internal", message: "boom" });
    const recovered = okOf(pg.update("main.eff", FILES["main.eff"]));
    assertEquals([...sets[2].keys()].sort(), Object.keys(FILES).sort());
    assertEquals(sets[2].get("users.eff"), BAD_USERS);
    assertEquals(recovered.diagnostics["users.eff"].length, 1);
    assertEquals(
      recovered.diagnostics["users.eff"][0].code,
      "type-mismatch/007",
    );
    assertEquals(recovered.outputs["users.eff"]?.stale, true);
  });
}

Deno.test("an internal error on start resends all files on the next edit", () => {
  const real = new Program("");
  let calls = 0;
  const program: ProgramPort = {
    update(changes) {
      if (++calls === 1) throw new Error("boom");
      return real.update(changes);
    },
  };
  const pg = createPlayground(FILES, { now: () => 0, program });
  const failed = pg.start();
  assert(!failed.ok && failed.error.tag === "internal");
  const recovered = okOf(pg.update("users.eff", BAD_USERS));
  assertEquals(Object.keys(recovered.outputs).sort(), SOURCE_PATHS);
  assertEquals(recovered.diagnostics["users.eff"].length, 1);
});

Deno.test("elapsedMs comes from the clock", () => {
  const times = [100, 107.5];
  const pg = createPlayground(FILES, { now: () => times.shift() ?? 0 });
  const result = okOf(pg.start());
  assertEquals(result.elapsedMs, 7.5);
});
