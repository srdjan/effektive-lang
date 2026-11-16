// The deferred Type kinds have no schema and no runtime value. `isDeferredKind`
// of type_kinds.ts is the one list of them. The table below has one sample for
// every Type kind, so a new kind is a compile error here until it is classified.

import { assertEquals } from "@std/assert";
import type { Effects, Type } from "../src/core/ir.ts";
import { isDeferredKind } from "../src/core/type_kinds.ts";

const NONE: Effects = { failures: [], requirements: [] };
const STRING: Type = { kind: "primitive", name: "string" };

const SAMPLES: { readonly [K in Type["kind"]]: Extract<Type, { kind: K }> } = {
  "primitive": { kind: "primitive", name: "string" },
  "literal": { kind: "literal", value: 1 },
  "named": { kind: "named", id: "type:m#T" },
  "record": { kind: "record", fields: [] },
  "array": { kind: "array", element: STRING },
  "tuple": { kind: "tuple", elements: [] },
  "union": { kind: "union", members: [] },
  "option": { kind: "option", element: STRING },
  "ref": { kind: "ref", element: STRING },
  "retry-schedule": { kind: "retry-schedule", error: STRING },
  "schema": {
    kind: "schema",
    decoded: STRING,
    encoded: STRING,
    decodeRequirements: [],
    encodeRequirements: [],
  },
  "effect": { kind: "effect", result: STRING, effects: NONE },
  "stream": { kind: "stream", element: STRING, effects: NONE },
  "sink": { kind: "sink", input: STRING, result: STRING, effects: NONE },
  "function": {
    kind: "function",
    execution: "pure",
    parameters: [],
    result: STRING,
    effects: NONE,
  },
  "provider": {
    kind: "provider",
    provides: [],
    acquisition: { execution: "pure", effects: NONE },
  },
};

Deno.test("isDeferredKind holds for exactly the eight deferred kinds", () => {
  const deferred = Object.values(SAMPLES).filter(isDeferredKind).map((t) =>
    t.kind
  ).sort();
  assertEquals(deferred, [
    "effect",
    "function",
    "provider",
    "ref",
    "retry-schedule",
    "schema",
    "sink",
    "stream",
  ]);
});
