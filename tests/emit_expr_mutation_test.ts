// Tests that kill older mutation survivors of the expression emitter.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { emitModule } from "../src/core/typescript.ts";
import { allExprs, emittedText, loweredModule } from "./helpers.ts";

const NO_CONFIG = { config: { host: new Map() } };

Deno.test("an error literal passes the type of each declared field to its value", () => {
  const text = emittedText(`type Int = int
type Code = "a" | "b"
export error Bad = { code: Code, n: Int }
export const mk = (): Bad => Bad({ code: "a", n: 1 })
`);
  assertStringIncludes(
    text,
    `export const mk = (): Bad => new Bad({ code: "a" as const, n: 1 });`,
  );
});

Deno.test("a service call passes the parameter types of its own method to its arguments", () => {
  const text = emittedText(`type Int = int
type Code = "x" | "y"
export service Svc {
  a(code: Code): Int
  b(n: Int): Int
}
export const f = (): Int with Svc.a | Svc.b => Svc.a("x")
export const g = (): Int with Svc.a | Svc.b => Svc.b(1)
`);
  assertStringIncludes(text, `Svc.use(($s) => $s.a("x" as const));`);
  assertStringIncludes(
    text,
    `export const g = (): Effect.Effect<Int, never, Svc> => Svc.use(($s) => $s.b(1));`,
  );
});

Deno.test("an effectful filter without an array parameter is an internal error", () => {
  const ir = loweredModule(`type Int = int
type Flag = boolean
service Probe { keep(n: Int): Flag }
export const f = (xs: Int[]): Int[] with Probe.keep => filter(xs, (n) => Probe.keep(n))
`);
  const [call] = allExprs(ir, "call");
  assert(call.callee.type.kind === "function");
  Object.assign(call.callee.type.parameters, [{
    kind: "primitive",
    name: "int",
  }]);

  assertEquals(emitModule(ir, NO_CONFIG), {
    ok: false,
    error: {
      tag: "internal",
      module: "m",
      message: "filter has no array parameter",
    },
  });
});

Deno.test("a catch with only a SchemaIssue handler adds no fallback for tagged errors", () => {
  const text = emittedText(`type Int = int
export const one = (issue: SchemaIssue): Int =>
  try { fail(issue) } catch { SchemaIssue(value) => 1 }
`);
  assertStringIncludes(
    text,
    `  }).pipe(
    Effect.catchIf(
      ($t0): $t0 is typeof $t0 & SchemaIssue.Issue => SchemaIssue.isIssue($t0),
      (value) => Effect.succeed(1),
    ),
  );`,
  );
});

Deno.test("a catch with a SchemaIssue handler and a tagged handler falls back to the tagged table", () => {
  const text = emittedText(`type Int = int
type Bool = boolean
export error Other = {}
export const two = (raise: Bool, issue: SchemaIssue): Int fails Other =>
  try { if (raise) { fail(issue) } else { fail(Other({})) } } catch {
    SchemaIssue(value) => fail(Other({})),
    Other(value) => 2
  }
`);
  assertStringIncludes(
    text,
    `  }).pipe(
    Effect.catchIf(
      ($t1): $t1 is typeof $t1 & SchemaIssue.Issue => SchemaIssue.isIssue($t1),
      (value) => Effect.fail(new Other({})),
      ($t0) =>
        Effect.fail($t0).pipe(
          Effect.catchTags({ "m#Other": (value) => Effect.succeed(2) }),
        ),
    ),
  );`,
  );
});
