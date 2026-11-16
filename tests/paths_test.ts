// Tests for the generated-file header helpers.

import { assertEquals } from "@std/assert";
import { generatedHeader, generatedSourceOf } from "../src/core/frontend.ts";

Deno.test("generatedSourceOf reads the source of an exact header", () => {
  assertEquals(
    generatedSourceOf(`${generatedHeader("a/m.eff")}\nexport {};\n`),
    "a/m.eff",
  );
  assertEquals(
    generatedSourceOf(generatedHeader("host.effi")),
    "host.effi",
  );
});

Deno.test("generatedSourceOf ignores one trailing CR on the first line", () => {
  assertEquals(
    generatedSourceOf(`${generatedHeader("m.eff")}\r\nexport {};\r\n`),
    "m.eff",
  );
});

Deno.test("generatedSourceOf rejects other first lines", () => {
  assertEquals(generatedSourceOf("export const x = 1;\n"), undefined);
  assertEquals(generatedSourceOf(""), undefined);
  assertEquals(
    generatedSourceOf(`\n${generatedHeader("m.eff")}\n`),
    undefined,
  );
  assertEquals(
    generatedSourceOf(`${generatedHeader("m.eff")} extra\n`),
    undefined,
  );
});

Deno.test("generatedSourceOf rejects a source without a stem or with a line terminator", () => {
  assertEquals(generatedSourceOf(generatedHeader(".eff")), undefined);
  assertEquals(generatedSourceOf(generatedHeader(".effi")), undefined);
  assertEquals(generatedSourceOf(generatedHeader("a\rb.eff")), undefined);
  assertEquals(generatedSourceOf(generatedHeader("a\u2028b.eff")), undefined);
  assertEquals(generatedSourceOf(generatedHeader("a\u2029b.eff")), undefined);
});

Deno.test("generatedSourceOf reads a one-character stem", () => {
  assertEquals(generatedSourceOf(generatedHeader("..eff")), "..eff");
  assertEquals(generatedSourceOf(generatedHeader("a.effi")), "a.effi");
});
