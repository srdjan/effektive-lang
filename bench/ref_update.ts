// deno-lint-ignore-file no-import-prefix -- the repo pins effect only in generated project configs

// Cost of ES-D3 (a): 1,000 updates of a Ref, of a SynchronizedRef, and of a
// SynchronizedRef with an effectful callback, each inside one Effect.gen.
// Run: deno bench --no-lock --allow-read --allow-env bench/ref_update.ts

import * as Effect from "npm:effect@4.0.5/Effect";
import * as Ref from "npm:effect@4.0.5/Ref";
import * as SynchronizedRef from "npm:effect@4.0.5/SynchronizedRef";

const UPDATES = 1000;
const indexes = Array.from({ length: UPDATES }, (_, i) => i);

Deno.bench("Ref.update x1000", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const ref = yield* Ref.make(0);
    for (const _ of indexes) yield* Ref.update(ref, (n) => n + 1);
  }));
});

Deno.bench("SynchronizedRef.update x1000", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make(0);
    for (const _ of indexes) yield* SynchronizedRef.update(ref, (n) => n + 1);
  }));
});

Deno.bench("SynchronizedRef.updateEffect x1000", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make(0);
    for (const _ of indexes) {
      yield* SynchronizedRef.updateEffect(ref, (n) => Effect.succeed(n + 1));
    }
  }));
});
