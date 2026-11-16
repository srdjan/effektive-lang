// Tests for the requirements that a type produces.

import { assertEquals } from "@std/assert";
import type { CapabilityId } from "../src/core/ir.ts";
import { producedRequirements } from "../src/core/requirement_provenance.ts";
import { TypeTable } from "../src/core/types.ts";

Deno.test("a type without a requirement leaves the set unchanged", () => {
  const table = TypeTable();
  const refs = [
    table.int,
    table.literal("a"),
    table.retrySchedule(table.error),
    table.error,
  ];
  assertEquals(
    refs.map((ref) =>
      producedRequirements(table, ref, new Set<CapabilityId>(), undefined)
    ),
    [new Set(), new Set(), new Set(), new Set()],
  );
});
