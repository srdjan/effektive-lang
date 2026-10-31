import { assertEquals } from "@std/assert";
import {
  dedupeDiagnostics,
  DIAGNOSTIC_CODES,
  sortDiagnostics,
} from "../src/core/diagnostics.ts";
import {
  categoryOf,
  describeCode,
  makeDiagnostic,
  normalizeDiagnostics,
  registeredCodes,
} from "../src/core/frontend.ts";
import { makeSpan } from "./helpers.ts";

Deno.test("every code has the form category/NNN and matches its category", () => {
  for (const code of registeredCodes()) {
    assertEquals(/^[a-z-]+\/\d{3}$/.test(code), true, code);
    assertEquals(describeCode(code).length > 10, true, code);
  }
});

Deno.test("registered diagnostics use documented categories", () => {
  const categories = [
    "syntax",
    "unknown-name",
    "module",
    "declaration",
    "type-mismatch",
    "failure-contract",
    "requirement-contract",
    "execution-mode",
    "pattern",
    "validation",
    "host-boundary",
    "sealed",
  ];
  for (const code of registeredCodes()) {
    assertEquals(categories.includes(categoryOf(code)), true, code);
  }
  assertEquals(Object.keys(DIAGNOSTIC_CODES).length > 0, true);
});

Deno.test("categoryOf returns the part of the code before the slash", () => {
  assertEquals(categoryOf("syntax/001"), "syntax");
  assertEquals(categoryOf("type-mismatch/001"), "type-mismatch");
  assertEquals(categoryOf("failure-contract/001"), "failure-contract");
  assertEquals(categoryOf("requirement-contract/001"), "requirement-contract");
  assertEquals(categoryOf("execution-mode/001"), "execution-mode");
  assertEquals(categoryOf("host-boundary/001"), "host-boundary");
});

Deno.test("makeDiagnostic fills category and severity and keeps related spans only when given", () => {
  const span = makeSpan("a.eff", 1, 2);
  const plain = makeDiagnostic("syntax/008", "m", span);
  assertEquals(plain.category, "syntax");
  assertEquals(plain.severity, "error");
  assertEquals("related" in plain, false);
  const related = makeDiagnostic("syntax/008", "m", span, [{
    span,
    message: "see",
  }]);
  assertEquals(related.related?.length, 1);
  assertEquals("related" in makeDiagnostic("syntax/008", "m", span, []), false);
});

Deno.test("sort orders by span, then code, then message; the input stays unchanged", () => {
  const a = makeDiagnostic("syntax/009", "z", makeSpan("a.eff", 5, 6));
  const b = makeDiagnostic("syntax/008", "y", makeSpan("a.eff", 1, 2));
  const c = makeDiagnostic("syntax/008", "x", makeSpan("a.eff", 1, 2));
  const d = makeDiagnostic("syntax/001", "w", makeSpan("a.eff", 1, 1));
  const input = [a, b, c, d];
  assertEquals(sortDiagnostics(input), [d, c, b, a]);
  assertEquals(input, [a, b, c, d]);
});

Deno.test("dedupe removes equal code, span, and message and keeps the first", () => {
  const span = makeSpan("a.eff", 1, 2);
  const a = makeDiagnostic("syntax/008", "m", span);
  const copy = makeDiagnostic("syntax/008", "m", { ...span });
  const other = makeDiagnostic("syntax/008", "n", span);
  assertEquals(dedupeDiagnostics([a, copy, other]), [a, other]);
  assertEquals(
    normalizeDiagnostics([other, copy, a]),
    [other, a].sort((x, y) => x.message < y.message ? -1 : 1),
  );
});
