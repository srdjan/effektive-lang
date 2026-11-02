import { assert, assertEquals } from "@std/assert";
import {
  applySourceEdits,
  contractActionsAt,
  Program,
} from "../src/core/frontend.ts";

const PRELUDE =
  "type Int = int\nerror Stop = {}\nservice Clock { now(): Int }\n";

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

const FAILS_ONLY = PRELUDE + "export const f = (): Int => fail(Stop({}))\n";
const FAILS_FIXED = PRELUDE +
  "export const f = (): Int fails Stop => fail(Stop({}))\n";

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
      "Add missing uses entries",
      PRELUDE + "export const f = (): Int uses Clock => Clock.now()\n",
    ]],
  );
  const both = "type Int = int\nerror Stop = {}\n" +
    "service Clock { now(): Int fails Stop }\n" +
    "export const f = (): Int => Clock.now()\n";
  assertEquals(actionsAt(both, 0, 500), [[
    "Add missing fails and uses entries",
    "type Int = int\nerror Stop = {}\n" +
    "service Clock { now(): Int fails Stop }\n" +
    "export const f = (): Int fails Stop uses Clock => Clock.now()\n",
  ]]);
  assertEquals(actionsAt(FAILS_ONLY, 0, 500), [[
    "Add missing fails entries",
    FAILS_FIXED,
  ]]);
});

Deno.test("contract actions: a body error that ends the function blocks the action", () => {
  assertEquals(
    actionsAt(
      PRELUDE + 'export const f = (): Int => fail(Stop({})) + "s"\n',
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
  const text = FAILS_ONLY + "export const g = (): Int => f()\n";
  assertEquals(actionsAt(text, text.indexOf("export const f")), []);
  assertEquals(
    actionsAt(text, text.indexOf("export const f"), undefined, true),
    [[
      "Add missing fails entries",
      FAILS_FIXED + "export const g = (): Int => f()\n",
    ]],
  );
});
