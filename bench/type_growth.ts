// Measurement of type-table growth (plan item SR13). Each edit gives one module
// a record type with a new field name, so each edit interns one new type shape.
// The script reports the type-table size, the heap after garbage collection,
// and the time of each edit. Run it with
// `deno run --v8-flags=--expose-gc --allow-read bench/type_growth.ts <edits>`.

import { Program } from "../src/core/frontend.ts";

function collectGarbage(): void {
  const gc: unknown = Reflect.get(globalThis, "gc");
  if (typeof gc !== "function") {
    throw new Error("run with --v8-flags=--expose-gc");
  }
  gc();
  gc();
}

function heapMiB(): number {
  collectGarbage();
  return Deno.memoryUsage().heapUsed / 2 ** 20;
}

function source(field: string): string {
  return `type Item = { ${field}: int }\nexport const id = (value: Item): Item => value\n`;
}

const edits = Number(Deno.args[0] ?? "1000");
const program = new Program("");
const configured = program.update({
  set: new Map([["effektive.json", "{}"]]),
});
const warm = program.update({ set: new Map([["main.eff", source("warm")]]) });
if (!configured.ok || !warm.ok) throw new Error("the warm-up update failed");
const startTypes = warm.value.types.size;
const startHeap = heapMiB();
const start = performance.now();
let last: ReturnType<typeof program.update> = warm;
for (let i = 0; i < edits; i++) {
  last = program.update({
    set: new Map([["main.eff", source(`field${i}`)]]),
  });
  if (!last.ok || last.value.diagnostics.length > 0) {
    throw new Error(`edit ${i} failed`);
  }
}
const elapsed = performance.now() - start;
const endHeap = heapMiB();
// Read the last revision after the heap sample. Otherwise V8 can collect the
// program before the sample, because no later statement uses it.
if (!last.ok) throw new Error("the last update failed");
const endTypes = last.value.types.size;
console.log(
  `edits ${edits}: types ${startTypes} -> ${endTypes}, heap ${
    startHeap.toFixed(2)
  } -> ${endHeap.toFixed(2)} MiB, ${
    Math.round((endHeap - startHeap) * 2 ** 20 / edits)
  } bytes and ${(elapsed / edits).toFixed(3)} ms for each edit`,
);
