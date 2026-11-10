// Tests for the slot type of a pure function value from an effect-mode
// expression (decision D6). A pure function fits an effect function slot, and
// the emitter wraps it there. The block of an `if` branch, of a `match` arm, and
// of a function body takes the type of its slot, not its own type.

import { assert, assertStringIncludes } from "@std/assert";
import { emitFiles } from "./helpers.ts";
import {
  ARM_PROGRAM,
  BRANCH_PROGRAM,
  INFERRED_PROGRAM,
  RESULT_PROGRAM,
} from "./lift_slot_programs.ts";

function emit(text: string): string {
  const emitted = emitFiles({ "effektive.json": "{}", "m.eff": text }, [
    "m.eff",
  ]).get("m");
  assert(emitted !== undefined, "module m was not emitted");
  return emitted.text;
}

/** The wrap of `pure` in a block result: the text calls it inside `Effect.succeed`, and it never returns it bare. */
function assertWrapped(output: string): void {
  assertStringIncludes(output, "Effect.succeed(pure(");
  assert(
    !output.includes("return pure;"),
    "the text returns pure without a wrap",
  );
}

Deno.test("an effect-mode if branch with a pure function type is wrapped", () => {
  assertWrapped(emit(BRANCH_PROGRAM));
});

Deno.test("an effect-mode match arm with a pure function type is wrapped", () => {
  assertWrapped(emit(ARM_PROGRAM));
});

Deno.test("an effect function body with a pure function result is wrapped", () => {
  assertWrapped(emit(RESULT_PROGRAM));
});

Deno.test("an effect-mode call with a pure function type binds its value once", () => {
  const output = emit(INFERRED_PROGRAM);
  assertStringIncludes(output, "Effect.succeed($");
  assert(!output.includes("=> mk();"), "the call is not lifted");
});

const CONTAINER_PROGRAM = [
  "type Int = int",
  "const one = (): Int => 1",
  "const mk = (): () => Int => { sleep(1ms)",
  "  () => 1 }",
  "const pm = (): pure () => Int => () => 1",
  "export const direct = (): (() => Int)[] => [() => 1]",
  "export const pair = (): [() => Int, Int] => [() => 1, 2]",
  "export const named = (): (() => Int)[] => [one]",
  "export const nested = (): (() => Int)[][] => [[() => 1]]",
  "export const elem = (): (() => Int)[] => [mk(), pm()]",
  "",
].join("\n");

Deno.test("a pure closure in an array literal of effect function elements is wrapped", () => {
  assertStringIncludes(
    emit(CONTAINER_PROGRAM),
    "=> [\n  () => Effect.succeed(1),\n];",
  );
});

Deno.test("a pure closure in a tuple literal of an effect function element is wrapped", () => {
  assertStringIncludes(
    emit(CONTAINER_PROGRAM),
    "=> [\n  () => Effect.succeed(1),\n  2,\n];",
  );
});

Deno.test("a named pure function in an array literal of effect function elements is wrapped", () => {
  assertStringIncludes(
    emit(CONTAINER_PROGRAM),
    "=> [\n  () => Effect.succeed(one()),\n];",
  );
});

Deno.test("a pure closure in a nested array literal is wrapped", () => {
  assertStringIncludes(
    emit(CONTAINER_PROGRAM),
    "=> [[() => Effect.succeed(1)]];",
  );
});

Deno.test("a pure function value after an effect in an array literal is wrapped", () => {
  assertStringIncludes(
    emit(CONTAINER_PROGRAM),
    "return [yield* mk(), () => Effect.succeed(pm()())];",
  );
});
