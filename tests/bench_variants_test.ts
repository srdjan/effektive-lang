// The order of the two warm language services in the paired sampling of the
// M5 variants. The services are recording doubles: the test needs no network
// and no TypeScript download.

import { assertEquals } from "@std/assert";
import {
  alternatingSampler,
  sampleVariant,
  type Service,
} from "../bench/m5_variants.ts";

function recordingService(name: string, calls: string[]): Service {
  return {
    check: () => {
      calls.push(name);
      return { ok: true, value: 1 };
    },
    dispose: () => {},
  };
}

Deno.test("the warm service sampler runs the sides in the order a, b, b, a for two pairs", async () => {
  const calls: string[] = [];
  const sampler = alternatingSampler(
    recordingService("a", calls),
    recordingService("b", calls),
  );
  const measured = await sampleVariant(
    sampler,
    { pairs: 2, warmups: 0 },
    "service",
    "target",
    "stamp",
  );
  assertEquals(measured.ok, true);
  assertEquals(calls, ["a", "b", "b", "a"]);
});
