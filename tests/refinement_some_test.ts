import { assert, assertEquals } from "@std/assert";
import {
  type CheckedProject,
  checkProject,
  lowerProject,
  memoryHost,
  validateProject,
} from "../src/core/mod.ts";
import type { ValueId } from "../src/core/ir.ts";
import { showType } from "../src/core/type_show.ts";

function check(text: string): CheckedProject {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": text }),
    "",
    ["m.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  return checked.value;
}

function parameterType(project: CheckedProject, name: string): string {
  const body = project.modules.get("m")?.functions.get(
    `value:m#${name}` as ValueId,
  );
  assert(body !== undefined);
  return showType(project.table, body.signature.parameters[0].type.ref);
}

function assertValid(project: CheckedProject): void {
  assertEquals(project.diagnostics, []);
  for (
    const diagnostics of validateProject(
      project.analysis.project,
      lowerProject(project),
    ).values()
  ) assertEquals(diagnostics, []);
}

Deno.test("Some proves a contextual refined element", () => {
  const valid = check(`
type Positive = int where n => n > 0
type Text = string
const direct = (): Option<Positive> => Some(1)
const union = (): Option<Positive> | Text => Some(1)
`);
  assertValid(valid);

  const invalid = check(`
type Positive = int where n => n > 0
const bad = (): Option<Positive> => Some(0)
`);
  assertEquals(invalid.diagnostics.map((diagnostic) => diagnostic.code), [
    "type-mismatch/013",
  ]);
});

Deno.test("Some context infers local and checked entry inputs", () => {
  const project = check(`
type Positive = int where n => n > 0
const local = (input): Option<Positive> => Some(input)
const piped = (input): Option<Positive> => input |> Some
export const entry = (input): Option<Positive> fails SchemaError => Some(input)
`);
  assertValid(project);
  assertEquals(parameterType(project, "local"), "Positive");
  assertEquals(parameterType(project, "piped"), "Positive");
  assertEquals(parameterType(project, "entry"), "Positive");
});

Deno.test("a refined constructor infers its direct input contract", () => {
  const project = check(`
type Positive = int where n => n > 0
type Int = int
type Window = { low: Int, high: Int } where w => w.high - w.low >= 1
type Created = { value: Int }
type Deleted = { value: Int }
type Event = Created | Deleted
const relational = (input): Window => Window({ low: input, high: input + 1 })
const tagged = (input): Created => Created(input)
export const entry = (input): Positive fails SchemaError => Positive(input)
`);
  assertValid(project);
  assertEquals(parameterType(project, "relational"), "Int");
  assertEquals(parameterType(project, "tagged"), "{ value: Int }");
  assertEquals(parameterType(project, "entry"), "Positive");
});

Deno.test("checked entries accept raw Some payloads and reject known invalid values", () => {
  const source = `
type Positive = int where n => n > 0
const take = (value: Option<Positive>): Option<Positive> => value
export const entry = (input): Option<Positive> fails SchemaError => take(input)
const direct = (raw: unknown): Option<Positive> fails SchemaError => entry(Some(raw))
const piped = (raw: unknown): Option<Positive> fails SchemaError => entry(raw |> Some)
`;
  assertValid(check(source));
  const invalid = check(
    source + `
const bad = (): Option<Positive> fails SchemaError => entry(Some(0))
const opaque = (): unknown => 1
const local = (): Option<Positive> fails SchemaError =>
  entry(if (true) { const value: Positive = opaque(); Some(value) } else { Some(1) })
`,
  );
  assertEquals(invalid.diagnostics.map((d) => d.code), [
    "type-mismatch/013",
    "type-mismatch/003",
    "type-mismatch/003",
  ]);
});
