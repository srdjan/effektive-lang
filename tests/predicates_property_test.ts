import { assertEquals } from "@std/assert";
import { makeRandom } from "../bench/generate.ts";
import {
  and,
  comparison,
  constant,
  entails,
  not,
  or,
  type Predicate,
  type Term,
} from "../src/core/predicates.ts";
import { verifyCertificate } from "../src/core/validate/predicates.ts";

// P3: property tests for the refinement solver. Each generated predicate is
// judged twice: by `entails` and by a brute-force evaluator over a finite
// domain. The integers x, y, and z each range over -3 .. 3.

type Name = "x" | "y" | "z";
type Assignment = Readonly<Record<Name, number>>;
type Operator = "<" | "<=" | "==" | "!=" | ">=" | ">";

const LIMITS = { maxSteps: 4000 };
const LOW = -3;
const HIGH = 3;
const OPERATORS: readonly Operator[] = ["<", "<=", "==", "!=", ">=", ">"];

const X: Term = { kind: "field", path: ["x"] };
const Y: Term = { kind: "field", path: ["y"] };
const Z: Term = { kind: "field", path: ["z"] };
const ZERO: Term = { kind: "zero" };
const TERMS: readonly Term[] = [X, Y, Z, ZERO];

const DOMAIN: readonly Assignment[] = (() => {
  const all: Assignment[] = [];
  for (let x = LOW; x <= HIGH; x++) {
    for (let y = LOW; y <= HIGH; y++) {
      for (let z = LOW; z <= HIGH; z++) all.push({ x, y, z });
    }
  }
  return all;
})();

function valueOf(term: Term, assignment: Assignment): bigint {
  if (term.kind === "zero") return 0n;
  if (term.kind === "field") {
    return BigInt(assignment[term.path[0] as Name]);
  }
  throw new Error(`the test evaluator cannot read a ${term.kind} term`);
}

function evaluate(predicate: Predicate, assignment: Assignment): boolean {
  switch (predicate.kind) {
    case "constant":
      return predicate.value;
    case "and":
      return predicate.operands.every((operand) =>
        evaluate(operand, assignment)
      );
    case "or":
      return predicate.operands.some((operand) =>
        evaluate(operand, assignment)
      );
    case "not":
      return !evaluate(predicate.operand, assignment);
    case "difference":
      return valueOf(predicate.left, assignment) -
          valueOf(predicate.right, assignment) <= BigInt(predicate.maximum);
  }
}

function truthTable(predicate: Predicate): readonly boolean[] {
  return DOMAIN.map((assignment) => evaluate(predicate, assignment));
}

function describe(predicate: Predicate): string {
  return JSON.stringify(predicate);
}

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function offset(random: Random): string {
  return String(Math.floor(random() * 7) - 3);
}

function atom(random: Random): Predicate {
  const result = comparison(
    pick(random, TERMS),
    offset(random),
    pick(random, OPERATORS),
    pick(random, TERMS),
    offset(random),
  );
  if (!result.ok) throw new Error(`comparison failed: ${result.error.tag}`);
  return result.value;
}

function generate(random: Random, depth: number): Predicate {
  const roll = random();
  if (depth === 0 || roll < 0.35) {
    return random() < 0.05 ? constant(random() < 0.5) : atom(random);
  }
  if (roll < 0.55) return not(generate(random, depth - 1));
  const operands = [generate(random, depth - 1), generate(random, depth - 1)];
  if (random() < 0.3) operands.push(generate(random, depth - 1));
  return roll < 0.8 ? and(...operands) : or(...operands);
}

function bounds(): Predicate {
  const parts: Predicate[] = [];
  for (const term of [X, Y, Z]) {
    for (
      const [operator, limit] of [[">=", String(LOW)], [
        "<=",
        String(HIGH),
      ]] as const
    ) {
      const result = comparison(term, "0", operator, ZERO, limit);
      if (!result.ok) throw new Error("bounds failed");
      parts.push(result.value);
    }
  }
  return and(...parts);
}

interface Case {
  readonly seed: number;
  readonly assumptions: Predicate;
  readonly predicate: Predicate;
  readonly satisfying: readonly Assignment[];
}

/** Draws cases until the assumptions have a model, so no case is vacuous. */
function casesFor(seed: number, count: number): readonly Case[] {
  const random = makeRandom(seed);
  const box = bounds();
  const cases: Case[] = [];
  while (cases.length < count) {
    const assumptions = random() < 0.5 ? box : and(box, generate(random, 2));
    const satisfying = DOMAIN.filter((assignment) =>
      evaluate(assumptions, assignment)
    );
    if (satisfying.length === 0) continue;
    cases.push({
      seed,
      assumptions,
      predicate: generate(random, 3),
      satisfying,
    });
  }
  return cases;
}

const SOLVER_SEEDS = [
  1,
  2,
  3,
  5,
  8,
  13,
  21,
  34,
  55,
  89,
  144,
  233,
  377,
  610,
  987,
  1597,
  2584,
  4181,
  6765,
  10946,
];
const CASES_PER_SEED = 10;

Deno.test("P3: entails agrees with brute force and its certificates verify", () => {
  const counts = { proved: 0, disproved: 0, unknown: 0, total: 0 };
  let verified = 0;
  for (const seed of SOLVER_SEEDS) {
    for (const item of casesFor(seed, CASES_PER_SEED)) {
      const where = `seed ${item.seed}, assumptions ${
        describe(item.assumptions)
      }, predicate ${describe(item.predicate)}`;
      const result = entails(item.assumptions, item.predicate, LIMITS);
      if (!result.ok) throw new Error(`entails failed (${where})`);
      counts.total++;
      const outcome = result.value;
      if (outcome.status === "unknown") {
        counts.unknown++;
        continue;
      }
      const wanted = outcome.status === "proved";
      if (wanted) counts.proved++;
      else counts.disproved++;
      const wrong = item.satisfying.filter((assignment) =>
        evaluate(item.predicate, assignment) !== wanted
      );
      assertEquals(
        wrong,
        [],
        `${outcome.status} is contradicted by these assignments (${where})`,
      );
      const checked = verifyCertificate(
        item.assumptions,
        item.predicate,
        outcome.certificate,
        LIMITS,
      );
      assertEquals(
        checked.ok,
        true,
        `verifyCertificate rejected the ${outcome.status} certificate (${where})`,
      );
      verified++;
    }
  }
  assertEquals(counts, { proved: 49, disproved: 52, unknown: 99, total: 200 });
  assertEquals(verified, 101);
});

const LAW_SEEDS = [7, 11, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];
const LAW_CASES_PER_SEED = 12;

const LAWS: readonly {
  readonly name: string;
  readonly left: (p: Predicate, q: Predicate) => Predicate;
  readonly right: (p: Predicate, q: Predicate) => Predicate;
}[] = [
  {
    name: "and(p, true) = p",
    left: (p) => and(p, constant(true)),
    right: (p) => p,
  },
  {
    name: "and(true, p) = p",
    left: (p) => and(constant(true), p),
    right: (p) => p,
  },
  {
    name: "and(p, false) = false",
    left: (p) => and(p, constant(false)),
    right: () => constant(false),
  },
  {
    name: "and(false, p) = false",
    left: (p) => and(constant(false), p),
    right: () => constant(false),
  },
  {
    name: "or(p, false) = p",
    left: (p) => or(p, constant(false)),
    right: (p) => p,
  },
  {
    name: "or(false, p) = p",
    left: (p) => or(constant(false), p),
    right: (p) => p,
  },
  {
    name: "or(p, true) = true",
    left: (p) => or(p, constant(true)),
    right: () => constant(true),
  },
  {
    name: "or(true, p) = true",
    left: (p) => or(constant(true), p),
    right: () => constant(true),
  },
  {
    name: "and(p, or(p, q)) = p",
    left: (p, q) => and(p, or(p, q)),
    right: (p) => p,
  },
  {
    name: "or(p, and(p, q)) = p",
    left: (p, q) => or(p, and(p, q)),
    right: (p) => p,
  },
];

Deno.test("P3: and and or obey identity and absorption laws", () => {
  let checks = 0;
  for (const seed of LAW_SEEDS) {
    const random = makeRandom(seed);
    for (let index = 0; index < LAW_CASES_PER_SEED; index++) {
      const p = generate(random, 3);
      const q = generate(random, 3);
      for (const law of LAWS) {
        assertEquals(
          truthTable(law.left(p, q)),
          truthTable(law.right(p, q)),
          `${law.name} fails (seed ${seed}, p ${describe(p)}, q ${
            describe(q)
          })`,
        );
        checks++;
      }
    }
  }
  assertEquals(checks, 1440);
});

Deno.test("P3: the laws hold for a constant operand in a generated disjunction", () => {
  let checks = 0;
  for (const seed of LAW_SEEDS) {
    const random = makeRandom(seed);
    for (let index = 0; index < LAW_CASES_PER_SEED; index++) {
      const p = generate(random, 3);
      const q = generate(random, 3);
      const pq = or(p, q);
      const withFalse = or(constant(false), p, q);
      const withTrue = or(p, constant(true), q);
      assertEquals(
        truthTable(withFalse),
        truthTable(pq),
        `or(false, p, q) differs from or(p, q) (seed ${seed}, p ${
          describe(p)
        }, q ${describe(q)})`,
      );
      assertEquals(
        truthTable(withTrue),
        DOMAIN.map(() => true),
        `or(p, true, q) is not true (seed ${seed}, p ${describe(p)}, q ${
          describe(q)
        })`,
      );
      checks++;
    }
  }
  assertEquals(checks, 144);
});
