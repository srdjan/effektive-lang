import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  compareSpans,
  invariantFailure,
  isInvariantFailure,
  rethrow,
} from "../src/core/source.ts";
import {
  caught,
  lineStarts,
  memoryHost,
  positionOf,
} from "../src/core/frontend.ts";
import { makeSpan } from "./helpers.ts";

Deno.test("invariant failures keep their message and phase through caught", () => {
  const result = caught(() => invariantFailure("emit", "missing checked node"));
  assert(!result.ok);
  assert(isInvariantFailure(result.error, "emit"));
  assertEquals(result.error.message, "missing checked node");
  assertEquals(isInvariantFailure(result.error, "lower"), false);
});

Deno.test("an unrelated error with a phase field is not an invariant failure", () => {
  const error = Object.assign(new Error("outside failure"), { phase: "emit" });
  assertEquals(isInvariantFailure(error, "emit"), false);
});

Deno.test("rethrow preserves the original error object", () => {
  const error = new Error("outside failure");
  const thrown = assertThrows(() => rethrow(error));
  assertStrictEquals(thrown, error);
});

Deno.test("lineStarts treats LF, CRLF, and lone CR as one terminator each", () => {
  assertEquals([...lineStarts("a\nb\r\nc\rd")], [0, 2, 5, 7]);
  assertEquals([...lineStarts("")], [0]);
  assertEquals([...lineStarts("a\n")], [0, 2]);
  assertEquals([...lineStarts("\r\n\r\n")], [0, 2, 4]);
});

Deno.test("positionOf gives one-based line and UTF-16 column", () => {
  const text = "é😀x\nyz";
  const starts = lineStarts(text);
  // "é" is one UTF-16 unit, the emoji is two, so "x" sits at offset 3.
  assertEquals(positionOf(starts, text, 0), { line: 1, column: 1 });
  assertEquals(positionOf(starts, text, 3), { line: 1, column: 4 });
  assertEquals(positionOf(starts, text, 5), { line: 2, column: 1 });
  assertEquals(positionOf(starts, text, 6), { line: 2, column: 2 });
});

Deno.test("positionOf clamps an offset past the end", () => {
  const text = "ab\ncd";
  const starts = lineStarts(text);
  assertEquals(positionOf(starts, text, 99), { line: 2, column: 3 });
  assertEquals(positionOf(starts, text, -4), { line: 1, column: 1 });
});

Deno.test("memoryHost returns text or a not-found error", () => {
  const host = memoryHost({ "a.eff": "const a = 1" });
  assertEquals(host.readText("a.eff"), { ok: true, value: "const a = 1" });
  assertEquals(host.readText("b.eff"), {
    ok: false,
    error: { tag: "not-found", path: "b.eff" },
  });
  const fromMap = memoryHost(new Map([["m.eff", "x"]]));
  assertEquals(fromMap.readText("m.eff"), { ok: true, value: "x" });
});

Deno.test("compareSpans orders by source name, then start, then end", () => {
  assertEquals(
    compareSpans(makeSpan("f", 2, 5), makeSpan("f", 4, 9)) < 0,
    true,
  );
  assertEquals(
    compareSpans(makeSpan("f", 4, 9), makeSpan("f", 2, 5)) > 0,
    true,
  );
  assertEquals(
    compareSpans(makeSpan("a", 9, 9), makeSpan("b", 0, 0)) < 0,
    true,
  );
  assertEquals(
    compareSpans(makeSpan("f", 2, 5), makeSpan("f", 2, 9)) < 0,
    true,
  );
  assertEquals(compareSpans(makeSpan("f", 2, 5), makeSpan("f", 2, 5)), 0);
});
