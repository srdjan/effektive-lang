# Order lifecycle application

This application is a witness for types with identity and tagged records. It is not one of the three
gate applications that the stopping rule in
[docs/status.md](../../../docs/status.md) names. It models an order and its
pricing with `type` declarations that have identity.

`contracts.eff` declares the four order states as tagged records: `Pending`,
`Paid`, `Shipped`, and `Cancelled`. It also declares the error
`InvalidTransition` and a recursive pricing rule tree: `Fixed`, `Times`,
`Percent`, `Capped`, and `Sum`. `orders.eff` imports these declarations, so tagged
records cross a module boundary.

Each state has a runtime `_tag` that includes the module name, for example
`"contracts#Pending"`. A function that accepts one state, such as
`pay(order: Pending, ...)`, rejects the other states at compile time. A `match`
over `Order` has one arm for each state and no `_` arm. A missing state gives
`pattern/001`.

`fromInput` decodes the structural type `OrderInput` from unknown JSON. It then
builds a `Pending` value with the data constructor. JSON that has a wrong or
missing `_tag` fails `decodeOrder`.

From the effektive-lang repository root:

```sh
deno task effektive build fixtures/applications/order-lifecycle --tsc
deno run --config fixtures/applications/order-lifecycle/deno.json fixtures/applications/order-lifecycle/main.ts
deno test --config fixtures/applications/order-lifecycle/deno.json fixtures/applications/order-lifecycle/runtime_test.ts
```

Build writes generated TypeScript beside the source files. The repository
harness runs compilation and application checks in a temporary directory.

```sh
deno test --allow-all tests/application_slow_test.ts
```

The pricing rules use `Times = { factor: Count }`. The price of `Times` is the
base price times the factor. The percent rule `Percent = { percent: Count }`
prices `round(base * Cents(p.percent) / 100)`. The `/` gives `number`, and the
builtin `round` gives an `int`, with a half rounded away from zero.

`runtime_test.ts` runs eleven compiled cases. They cover each transition, each
`stateOf` and `describe` result, `isOpen`, and the `InvalidTransition` failure.
They also price the sample rule from source and one rule that TypeScript builds
with `make`. Two cases price the percent rule, one of them with a half that rounds up. They decode valid and invalid input, check that the encoded form
keeps `_tag`, and check the rejected decode of a wrong `_tag`.

See [the plan](../../../docs/archive/plans/2026-10-23-nominal-examples.md) for the
design.
