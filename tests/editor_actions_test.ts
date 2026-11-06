import { assert, assertEquals } from "@std/assert";
import {
  applySourceEdits,
  contractActionsAt,
  failsClauseActionsAt,
  Program,
} from "../src/core/frontend.ts";

const PRELUDE =
  "type Int = int\nerror Stop = {}\nerror Other = {}\nservice Clock { now(): Int }\n";

/** Titles and rewritten texts of the contract actions at the range. */
function actionsAt(
  text: string,
  start: number,
  end = start,
  allowCallerGaps = false,
  path = "m.eff",
): readonly (readonly [string, string])[] {
  const loaded = new Program("").update({
    set: { "effektive.json": "{}", "m.eff": text },
  });
  assert(loaded.ok);
  return contractActionsAt(loaded.value, path, start, end, allowCallerGaps).map(
    (
      action,
    ) => [action.title, applySourceEdits(text, action.edits)] as const,
  );
}

const FAILS_ONLY = PRELUDE +
  "export const f = (): Int fails Other => fail(Stop({}))\n";
const FAILS_FIXED = PRELUDE +
  "export const f = (): Int fails Other | Stop => fail(Stop({}))\n";

Deno.test("contract actions: a path without a module has none", () => {
  assertEquals(actionsAt(FAILS_ONLY, 0, 0, false, "gone.eff"), []);
});

Deno.test("contract actions: the range may touch the first and last offset of the function", () => {
  const first = FAILS_ONLY.indexOf("export const f");
  const last = FAILS_ONLY.length - 1;
  assertEquals(actionsAt(FAILS_ONLY, last), [[
    "Add missing fails entries",
    FAILS_FIXED,
  ]]);
  assertEquals(actionsAt(FAILS_ONLY, 0, first), [[
    "Add missing fails entries",
    FAILS_FIXED,
  ]]);
  assertEquals(actionsAt(FAILS_ONLY, FAILS_ONLY.length), []);
  assertEquals(actionsAt(FAILS_ONLY, 0, first - 1), []);
});

Deno.test("contract actions: a function without a written result has none", () => {
  assertEquals(
    actionsAt(PRELUDE + "export const f = () => fail(Stop({}))\n", 0, 500),
    [],
  );
  assertEquals(
    actionsAt(
      PRELUDE + "export const f: () => Int = () => fail(Stop({}))\n",
      0,
      500,
    ),
    [],
  );
});

Deno.test("contract actions: the title names the kinds of the missing entries", () => {
  assertEquals(
    actionsAt(
      PRELUDE + "export const f = (): Int => Clock.now()\n",
      0,
      500,
    ),
    [[
      "Add missing with entries",
      PRELUDE + "export const f = (): Int with Clock => Clock.now()\n",
    ]],
  );
  const both = "type Int = int\nerror Stop = {}\nerror Other = {}\n" +
    "service Clock { now(): Int fails Stop }\n" +
    "export const f = (): Int fails Other => Clock.now()\n";
  assertEquals(actionsAt(both, 0, 500), [[
    "Add missing fails and with entries",
    "type Int = int\nerror Stop = {}\nerror Other = {}\n" +
    "service Clock { now(): Int fails Stop }\n" +
    "export const f = (): Int fails Other | Stop with Clock => Clock.now()\n",
  ]]);
  assertEquals(actionsAt(FAILS_ONLY, 0, 500), [[
    "Add missing fails entries",
    FAILS_FIXED,
  ]]);
});

Deno.test("contract actions: a body error that ends the function blocks the action", () => {
  assertEquals(
    actionsAt(
      PRELUDE +
        'export const f = (): Int fails Other => fail(Stop({})) + "s"\n',
      0,
      500,
    ),
    [],
  );
});

Deno.test("contract actions: an unknown name in the body blocks the action", () => {
  assertEquals(
    actionsAt(
      PRELUDE +
        "export const f = (): Int fails Other => if (missing) { fail(Stop({})) } else { fail(Other({})) }\n",
      0,
      500,
    ),
    [],
  );
});

Deno.test("contract actions: a broken declaration has none", () => {
  assertEquals(
    actionsAt(
      PRELUDE + "export const f = (): Int => fail(Stop({})) +\n",
      0,
      500,
    ),
    [],
  );
});

Deno.test("contract actions: an action that breaks a closed caller needs allowCallerGaps", () => {
  const text = FAILS_ONLY + "export const g = (): Int fails Other => f()\n";
  assertEquals(actionsAt(text, text.indexOf("export const f")), []);
  assertEquals(
    actionsAt(text, text.indexOf("export const f"), undefined, true),
    [[
      "Add missing fails entries",
      FAILS_FIXED + "export const g = (): Int fails Other => f()\n",
    ]],
  );
});

/** Titles and rewritten texts of the fails clause actions at the range. */
function failsActionsAt(
  files: Readonly<Record<string, string>>,
  start: number,
  path = "m.eff",
): readonly (readonly [string, string])[] {
  const loaded = new Program("").update({
    set: { "effektive.json": "{}", ...files },
  });
  assert(loaded.ok);
  return failsClauseActionsAt(loaded.value, path, start).map((action) =>
    [action.title, applySourceEdits(files[path], action.edits)] as const
  );
}

/** The diagnostic codes of the project after the first fails clause action. */
function codesAfterFailsAction(text: string, start: number): string[] {
  const loaded = new Program("").update({
    set: { "effektive.json": "{}", "m.eff": text },
  });
  assert(loaded.ok);
  const [action] = failsClauseActionsAt(loaded.value, "m.eff", start);
  const edited = new Program("").update({
    set: {
      "effektive.json": "{}",
      "m.eff": applySourceEdits(text, action.edits),
    },
  });
  assert(edited.ok);
  return edited.value.diagnostics.map((d) => d.code);
}

const TWO_FAILURES = PRELUDE +
  "export const f = (n: Int): Int => if (n > 0) { fail(Stop({})) } else { fail(Other({})) }\n";

Deno.test("fails clause: W0 the users example gets its inferred failures", () => {
  const users = Deno.readTextFileSync("fixtures/examples/users.eff");
  const service = Deno.readTextFileSync(
    "fixtures/examples/users-service.eff",
  );
  const at = users.indexOf("getUser");
  const files = {
    "users.eff": users,
    "users-service.eff": service,
  };
  assertEquals(failsActionsAt(files, at, "users.eff"), [[
    "Write fails StoreUnavailable | UserMissing",
    users.replace(
      "(id: UserId): User =>",
      "(id: UserId): User fails StoreUnavailable | UserMissing =>",
    ),
  ]]);
  const loaded = new Program("").update({
    set: { "effektive.json": "{}", ...files },
  });
  assert(loaded.ok);
  const [action] = failsClauseActionsAt(loaded.value, "users.eff", at);
  assert(action !== undefined);
  const edited = new Program("").update({
    set: {
      "effektive.json": "{}",
      ...files,
      "users.eff": applySourceEdits(users, action.edits),
    },
  });
  assert(edited.ok);
  assertEquals(edited.value.diagnostics, []);
});

Deno.test("fails clause: W1 the names come in the order of the failure set", () => {
  assertEquals(failsActionsAt({ "m.eff": TWO_FAILURES }, PRELUDE.length), [[
    "Write fails Other | Stop",
    PRELUDE +
    "export const f = (n: Int): Int fails Other | Stop => if (n > 0) { fail(Stop({})) } else { fail(Other({})) }\n",
  ]]);
});

Deno.test("fails clause: W2 the clause goes before a written with clause", () => {
  const text = PRELUDE +
    "export const f = (): Int with Clock.now => fail(Stop({}))\n";
  assertEquals(failsActionsAt({ "m.eff": text }, PRELUDE.length), [[
    "Write fails Stop",
    PRELUDE +
    "export const f = (): Int fails Stop with Clock.now => fail(Stop({}))\n",
  ]]);
});

Deno.test("fails clause: W3 a split header gets the clause at the end of the result", () => {
  const text = PRELUDE +
    "export const f = (): Int\n  with Clock.now => fail(Stop({}))\n";
  assertEquals(failsActionsAt({ "m.eff": text }, PRELUDE.length), [[
    "Write fails Stop",
    PRELUDE +
    "export const f = (): Int fails Stop\n  with Clock.now => fail(Stop({}))\n",
  ]]);
});

Deno.test("fails clause: W4 a checked input writes SchemaError", () => {
  const text = PRELUDE + "export const c = (n): Int => n + 1\n";
  assertEquals(failsActionsAt({ "m.eff": text }, PRELUDE.length), [[
    "Write fails SchemaError",
    PRELUDE + "export const c = (n): Int fails SchemaError => n + 1\n",
  ]]);
  assertEquals(codesAfterFailsAction(text, PRELUDE.length), []);
});

Deno.test("fails clause: W5 an empty set writes never", () => {
  assertEquals(
    failsActionsAt(
      { "m.eff": PRELUDE + "export const p = (n: Int): Int => n\n" },
      PRELUDE.length,
    ),
    [[
      "Write fails never",
      PRELUDE + "export const p = (n: Int): Int fails never => n\n",
    ]],
  );
});

Deno.test("fails clause: W6 a try that handles every failure writes never", () => {
  const text = PRELUDE +
    "export const t = (): Int => try { fail(Stop({})) } catch { Stop(error) => 1 }\n";
  assertEquals(failsActionsAt({ "m.eff": text }, PRELUDE.length), [[
    "Write fails never",
    PRELUDE +
    "export const t = (): Int fails never => try { fail(Stop({})) } catch { Stop(error) => 1 }\n",
  ]]);
});

Deno.test("fails clause: W7 an error that the module cannot see gives no action", () => {
  const lib = "export type Int = int\nerror Hidden = {}\n" +
    "export const boom = (): Int fails Hidden => fail(Hidden({}))\n";
  const text = 'import { Int, boom } from "./lib.eff"\n' +
    "export const f = (): Int => boom()\n";
  assertEquals(
    failsActionsAt({ "lib.eff": lib, "m.eff": text }, text.indexOf("f =")),
    [],
  );
});

Deno.test("fails clause: W8 a written fails clause gives no action", () => {
  const text = PRELUDE +
    "export const f = (): Int fails Stop => fail(Stop({}))\n";
  assertEquals(failsActionsAt({ "m.eff": text }, PRELUDE.length), []);
});

Deno.test("fails clause: W9 a function without a written result gives no action", () => {
  assertEquals(
    failsActionsAt(
      { "m.eff": PRELUDE + "const l = (n: Int) => n\n" },
      PRELUDE.length,
    ),
    [],
  );
});

Deno.test("fails clause: W10 a function with a body error gives no action", () => {
  assertEquals(
    failsActionsAt(
      { "m.eff": PRELUDE + "export const f = (): Int => missing\n" },
      PRELUDE.length,
    ),
    [],
  );
});

Deno.test("fails clause: W11 only the header holds the cursor", () => {
  const header = TWO_FAILURES.indexOf("(n: Int)");
  const afterArrow = TWO_FAILURES.indexOf("=>") + 2;
  const body = TWO_FAILURES.indexOf("if (");
  const fixed = "Write fails Other | Stop";
  assertEquals(
    failsActionsAt({ "m.eff": TWO_FAILURES }, PRELUDE.length).map((a) => a[0]),
    [fixed],
  );
  assertEquals(
    failsActionsAt({ "m.eff": TWO_FAILURES }, afterArrow).map((a) => a[0]),
    [fixed],
  );
  assertEquals(failsActionsAt({ "m.eff": TWO_FAILURES }, body), []);
  assertEquals(
    failsActionsAt({ "m.eff": TWO_FAILURES }, header).map((a) => a[0]),
    [fixed],
  );
});

Deno.test("fails clause: W12 a cursor in the first of two headers gives the action of the first", () => {
  const text = PRELUDE + "export const a = (): Int => fail(Stop({}))\n" +
    "export const b = (): Int => fail(Other({}))\n";
  assertEquals(
    failsActionsAt({ "m.eff": text }, PRELUDE.length),
    [[
      "Write fails Stop",
      PRELUDE + "export const a = (): Int fails Stop => fail(Stop({}))\n" +
      "export const b = (): Int => fail(Other({}))\n",
    ]],
  );
});

Deno.test("fails clause: W13 a binding type gives no action", () => {
  const text = PRELUDE + "export const b: (n: Int) => Int = (n) => n\n";
  assertEquals(failsActionsAt({ "m.eff": text }, PRELUDE.length), []);
});

Deno.test("fails clause: W14 a written never extends by replacement", () => {
  const text = PRELUDE +
    "export const p = (n: Int): Int fails never => fail(Stop({}))\n";
  assertEquals(actionsAt(text, PRELUDE.length), [[
    "Add missing fails entries",
    PRELUDE + "export const p = (n: Int): Int fails Stop => fail(Stop({}))\n",
  ]]);
});

Deno.test("fails clause: W15 a recursive function gets its clause", () => {
  const text = PRELUDE +
    "export const r = (n: Int): Int => if (n > 0) { r(n - 1) } else { fail(Stop({})) }\n";
  assertEquals(failsActionsAt({ "m.eff": text }, PRELUDE.length), [[
    "Write fails Stop",
    PRELUDE +
    "export const r = (n: Int): Int fails Stop => if (n > 0) { r(n - 1) } else { fail(Stop({})) }\n",
  ]]);
  assertEquals(codesAfterFailsAction(text, PRELUDE.length), []);
});

Deno.test("fails clause: W16 a written with never extends by replacement", () => {
  const text = PRELUDE +
    "export const g = (): Int with never => Clock.now()\n";
  assertEquals(actionsAt(text, PRELUDE.length), [[
    "Add missing with entries",
    PRELUDE + "export const g = (): Int with Clock => Clock.now()\n",
  ]]);
});

Deno.test("fails clause: W17 a path without a module gives no action", () => {
  assertEquals(failsActionsAt({ "m.eff": TWO_FAILURES }, 0, "gone.eff"), []);
});

Deno.test("fails clause: W18 a cursor before the header gives no action", () => {
  assertEquals(failsActionsAt({ "m.eff": TWO_FAILURES }, 0), []);
});

Deno.test("fails clause: W19 an arrow with a binding type gives no action", () => {
  const text = PRELUDE +
    "export const b: (n: Int) => Int = (n: Int): Int => n\n";
  assertEquals(failsActionsAt({ "m.eff": text }, PRELUDE.length), []);
});

Deno.test("fails clause: W20 a broken declaration gives no action", () => {
  const text = PRELUDE +
    "export const f = (n: Int): Int => if f (n > 0) { fail(Stop({})) } else { Clock.now() }\n";
  assertEquals(failsActionsAt({ "m.eff": text }, PRELUDE.length), []);
});
