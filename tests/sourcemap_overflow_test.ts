import { assert, assertEquals } from "@std/assert";
import { decodeMappings, encodeVlq } from "../src/core/typescript.ts";

function mapping(field: number, second: number): string {
  const first = [0, 0, 0, 0];
  const next = [0, 0, 0, 0];
  first[field] = Number.MAX_SAFE_INTEGER;
  next[field] = second;
  return first.map(encodeVlq).join("") + (field === 0 ? "," : ";") +
    next.map(encodeVlq).join("");
}

Deno.test("source-map positions reject accumulated numeric overflow", () => {
  for (const field of [0, 1, 2, 3]) {
    assertEquals(decodeMappings(mapping(field, 1)), {
      ok: false,
      error: { tag: "overflow", line: field === 0 ? 0 : 1 },
    });
  }
});

Deno.test("source-map positions retain accumulated safe integers", () => {
  for (const field of [0, 1, 2, 3]) {
    const decoded = decodeMappings(mapping(field, 0));
    assert(decoded.ok);
    const line = decoded.value[field === 0 ? 0 : 1];
    const segment = line[line.length - 1];
    const coordinates = [
      segment.generatedColumn,
      segment.source,
      segment.line,
      segment.column,
    ];
    assertEquals(coordinates[field], Number.MAX_SAFE_INTEGER);
  }
});
