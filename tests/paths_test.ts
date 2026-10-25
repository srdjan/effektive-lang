// Tests for the generated-file header helpers.

import { assertEquals } from "@std/assert";
import { generatedHeader, generatedSourceOf } from "../src/core/paths.ts";

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
