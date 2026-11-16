// @light-fp adapter

// Cost of ES-D3 (a): 1,000 updates of a Ref, of a SynchronizedRef, and of a
// SynchronizedRef with an effectful callback, each inside one Effect.gen.
// Run: deno bench --no-lock --allow-read --allow-env bench/ref_update.ts

// deno-lint-ignore no-import-prefix -- this benchmark retains the generated target's exact Effect version
import * as Effect from "npm:effect@4.1.2/Effect";
// deno-lint-ignore no-import-prefix -- this benchmark retains the generated target's exact Effect version
import * as Ref from "npm:effect@4.1.2/Ref";
// deno-lint-ignore no-import-prefix -- this benchmark retains the generated target's exact Effect version
import * as SynchronizedRef from "npm:effect@4.1.2/SynchronizedRef";

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
