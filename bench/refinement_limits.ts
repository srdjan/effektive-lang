import { Program } from "../src/core/db.ts";
import {
  and,
  comparison,
  entails,
  or,
  type Predicate,
  type Term,
} from "../src/core/predicates.ts";

const iterations = Number(Deno.args[0] ?? "1");
if (!Number.isSafeInteger(iterations) || iterations < 1) {
  throw new Error("positive iteration count required");
}
const zero: Term = { kind: "zero" };
const compare = (
  term: Term,
  operator: "<" | ">" | "===",
  offset: string,
): Predicate => {
  const result = comparison(term, "0", operator, zero, offset);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};
const terms: Term[] = Array.from(
  { length: 10 },
  (_, i) => ({ kind: "field", path: [`x${i}`] }),
);
const assumptions = and(
  ...terms.map((term) => or(compare(term, "<", "0"), compare(term, ">", "0"))),
  ...terms.map((term) => compare(term, "===", "0")),
);
const goal = compare(terms[0], ">", "0");
const limits = [128, 512, 2048, 8192, 32768, 100000];
const rows = [];
for (const maxSteps of limits) {
  const samples = [];
  let stepsUsed = 0;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = entails(assumptions, goal, { maxSteps });
    samples.push(performance.now() - start);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    if (
      result.value.status !== "unknown" || result.value.reason !== "exhausted"
    ) throw new Error("adversarial workload did not exhaust its work bound");
    stepsUsed = result.value.stepsUsed;
    if (stepsUsed > maxSteps) throw new Error("solver exceeded work bound");
  }
  samples.sort((a, b) => a - b);
  rows.push({
    maxSteps,
    stepsUsed,
    p90Ms: samples[Math.ceil(samples.length * 0.9) - 1],
    maxMs: samples.at(-1),
  });
}

const count = 200;
const source = (edit: number): string =>
  [
    "type Positive = int where n => n > 0",
    ...Array.from({ length: count }, (_, index) =>
      `const f${index} = (n: Positive): Positive => n + 1`),
    `const edit = ${edit}`,
  ].join("\n");
const program = new Program("");
const updates: number[] = [];
for (let edit = 0; edit < iterations; edit++) {
  const start = performance.now();
  const revision = program.update({
    set: { "effektive.json": "{}", "m.eff": source(edit) },
  });
  updates.push(performance.now() - start);
  if (!revision.ok || revision.value.diagnostics.length > 0) {
    throw new Error(JSON.stringify(revision));
  }
}
updates.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      iterations,
      workload: "ten contradictory Boolean splits",
      rows,
      compiler: {
        functions: count,
        updates: iterations,
        p90Ms: updates[Math.ceil(updates.length * 0.9) - 1],
        maxMs: updates.at(-1),
      },
    },
    null,
    2,
  ),
);
