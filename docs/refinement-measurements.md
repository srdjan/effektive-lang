# Refinement measurements

The measurements used Deno 2.9.8 on the local Apple silicon host on 2026-10-25.
The solver summaries and editor samples are in [the result file](evidence/refinement-measurements.json).

The first run used one iteration. The next run changed only the iteration count to 30.
Both runs finished in less than one minute.

```sh
deno run bench/refinement_limits.ts 1
deno run bench/refinement_limits.ts 30
```

The solver workload contains ten contradictory Boolean splits.
Every measured work limit exhausted and returned `unknown`.
The harness asserts that the solver never spends more steps than its allowance.

| Work allowance | p90 milliseconds | Maximum milliseconds |
| --- | ---: | ---: |
| 128 | 0.041458 | 0.331250 |
| 512 | 0.057667 | 0.200000 |
| 2,048 | 0.087333 | 0.128708 |
| 8,192 | 0.315375 | 0.359625 |
| 32,768 | 0.837000 | 0.888708 |
| 100,000 | 2.508417 | 2.634291 |

The compiler workload checks 200 refined functions in one module through `Program.update`.
Thirty distinct source updates had a p90 of 5.839916 milliseconds and a maximum of 15.316834 milliseconds.
Every update had no diagnostics. The existing editor budget is 100 milliseconds at p90.

The source checker permits 8,192 solver steps per query and 100,000 steps per compiler update.
Every body shares the update allowance. The checker subtracts actual solver work.
The independent certificate checker has its own bounded work counters.
Exhaustion rejects the affected static obligation. These measurements establish no general latency or memory bound.

The first complete inferred-entry runtime test passed in 623 milliseconds.
It included source checking, lowering, independent validation, emission, strict TypeScript checking, and runtime execution.

The final review measured two additional workloads with seven samples at each size.
One workload checks typed arrows in one block. The other requests signature help through chained local aliases.
Both workloads first passed at 100 items before the workloads increased to 2,000 items.
The maximum of seven samples supplies each reported p90.

The typed-arrow workload now skips input inference for concrete parameters.
At 2,000 arrows, its p90 changed from 210.41 to 143.547416 milliseconds.
Signature help now indexes local declarations once per visited module.
At 2,000 aliases, its p90 changed from 127.21 to 0.583625 milliseconds.
All measured compiler updates had no diagnostics. Every signature request retained the original parameter name.

The main agent repeated both workloads at 100 and 2,000 items.
At 2,000 items, the repeated p90 values were 151.406041 and 0.926375 milliseconds, respectively.
The large typed-arrow workload exceeds the existing editor budget. These measurements do not establish a general editor latency guarantee.

The solver step allowance does not bound allocations during Boolean splits.
The independent validator uses a fresh 100,000-step allowance for each declaration.
These runs do not measure module-wide validation or large pending constraint arrays.
