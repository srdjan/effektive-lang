// Mutation tests for the independent IR validator. Each case lowers an
// accepted source, checks that the validator reports nothing, changes one fact
// of a copy of the IR, and requires the exact validation code, the IR path of
// the operation, and a fragment of the rule message. A mutation is coherent: it
// replaces a whole argument expression, or it changes a closure and its
// function type together, so the validator reaches the operation rule and not
// only the annotation check of a child.
//
// Cases that other tests already cover are not repeated here:
//   a null member in Schema data where the rule forbids it
//     -> schema_validator_forged_test.ts "validator keeps null data distinct
//        from unit and numeric annotations"
//   an encodingStrategy literal outside the accepted set
//     -> schema_validator_forged_test.ts "validator rejects malformed default
//        strategies and erased static encoder services"

import { assert, assertEquals } from "@std/assert";
import type { Diagnostic } from "../src/core/frontend.ts";
import type { ModuleIR } from "../src/core/ir.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import { validateModule } from "../src/core/validate/index.ts";

// ------------------------------------------------------------------ helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function segments(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    out.push(m[1] !== undefined ? m[1] : Number(m[2]));
  }
  return out;
}

function child(parent: unknown, key: string | number): unknown {
  if (typeof key === "number") {
    assert(Array.isArray(parent), `not an array at [${key}]`);
    return parent[key];
  }
  assert(isRecord(parent), `not an object at ${key}`);
  return parent[key];
}

function at(root: unknown, path: string): unknown {
  let current = root;
  for (const key of segments(path)) current = child(current, key);
  return current;
}

function setAt(root: unknown, path: string, value: unknown): void {
  const parts = segments(path);
  const last = parts.pop();
  assert(last !== undefined, "empty path");
  const parent = parts.reduce(child, root);
  if (typeof last === "number") {
    assert(Array.isArray(parent), `not an array before [${last}]`);
    parent[last] = value;
  } else {
    assert(isRecord(parent), `not an object before ${last}`);
    parent[last] = value;
  }
}

const NONE = { failures: [], requirements: [] };

interface Lowered {
  readonly ir: ModuleIR;
  readonly sources: ReadonlyMap<string, string>;
}

function lowerText(text: string): Lowered {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": text }),
    "",
    ["m.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics.map((d) => d.code), []);
  const result = lowerProject(checked.value).get("m");
  assert(result?.ok === true, JSON.stringify(result));
  return { ir: result.value, sources: new Map([["m.eff", text]]) };
}

function declarationIndex(ir: ModuleIR, name: string): number {
  const index = ir.declarations.findIndex((d) => d.name === name);
  assert(index >= 0, `no declaration named ${name}`);
  return index;
}

/** One expected diagnostic. The path is relative to the declaration ("" is the declaration). */
interface Expected {
  readonly code: string;
  readonly path: string;
  readonly fragment: string;
}

interface Mutation {
  readonly label: string;
  readonly declaration: string;
  /** Each edit sets the value at a path below the declaration. */
  readonly edits: readonly (readonly [
    path: string,
    value: (declaration: unknown) => unknown,
  ])[];
  readonly expected: readonly Expected[];
}

function show(diagnostics: readonly Diagnostic[]): string {
  return JSON.stringify(diagnostics.map((d) => [d.code, d.message]), null, 1);
}

function runMutations(
  lowered: Lowered,
  mutations: readonly Mutation[],
): void {
  assertEquals(
    validateModule(lowered.ir, lowered.sources),
    [],
    "the unchanged IR validates",
  );
  for (const mutation of mutations) {
    const ir = structuredClone(lowered.ir);
    const index = declarationIndex(ir, mutation.declaration);
    const declaration = ir.declarations[index];
    for (const [path, value] of mutation.edits) {
      setAt(declaration, path, value(declaration));
    }
    const found = validateModule(ir, lowered.sources);
    for (const expected of mutation.expected) {
      const prefix = `declarations[${index}]${
        expected.path === ""
          ? ""
          : expected.path.startsWith("[")
          ? expected.path
          : `.${expected.path}`
      }:`;
      assert(
        found.some((d) =>
          d.code === expected.code && d.message.startsWith(`${prefix} `) &&
          d.message.includes(expected.fragment)
        ),
        `${mutation.label}: expected ${expected.code} at ${prefix} with ${
          JSON.stringify(expected.fragment)
        }, got ${show(found)}`,
      );
    }
  }
}

// ---------------------------------------------------------- channel erasure

Deno.test("channel erasure: mapEffect loses one failure or requirement and keeps the callback evidence", () => {
  const lowered = lowerText(`
type Int = int
error Stop = {}
error Other = {}
service Work { run(): void fails Other; value(key: Int): Int fails Stop }
const used = (source: Stream<Int, Stop, Work.value>): Stream<Int, Stop | Other, Work.value | Work.run> =>
 mapEffect(source, (n) => { Work.run(); Work.value(n) })
`);
  runMutations(lowered, [
    {
      label: "mapEffect loses Other",
      declaration: "used",
      edits: [["body.type.effects.failures", () => ["error:m#Stop"]]],
      expected: [{
        code: "validation/002",
        path: "body.type",
        fragment: "expected Stream<",
      }],
    },
    {
      label: "mapEffect loses Work.run",
      declaration: "used",
      edits: [[
        "body.type.effects.requirements",
        () => ["cap:m#Work.value"],
      ]],
      expected: [{
        code: "validation/002",
        path: "body.type",
        fragment: "expected Stream<",
      }],
    },
  ]);
});

// ------------------------------------------------------------------- Schema

Deno.test("equality of two nullable operands without a null operand is rejected", () => {
  const lowered = lowerText(`
type Int = int
type Text = string
type Bool = boolean
type Nullable = Text | null
type Count = Int | null
const same = (x: Nullable, y: Nullable): Bool => x === null
const different = (x: Nullable, y: Count): Bool => x !== null
`);
  const nullable = { kind: "named", id: "type:m#Nullable" };
  const count = { kind: "named", id: "type:m#Count" };
  const reference =
    (name: string, id: string, type: unknown) => (d: unknown) => ({
      kind: "reference",
      target: `local:m#${name}/${id}`,
      type,
      execution: "pure",
      effects: NONE,
      span: child(at(d, "body.right"), "span"),
    });
  const rule = "does not accept operands of type";
  runMutations(lowered, [
    {
      label: "x === y with equal nullable unions",
      declaration: "same",
      edits: [["body.right", reference("same", "y", nullable)]],
      expected: [{ code: "validation/002", path: "body", fragment: rule }],
    },
    {
      label: "x !== y with different nullable unions",
      declaration: "different",
      edits: [["body.right", reference("different", "y", count)]],
      expected: [{ code: "validation/002", path: "body", fragment: rule }],
    },
  ]);
});
