# Testing

This file describes the test system. It states what each oracle proves and what each oracle can miss. [development.md](development.md) lists the commands, and it describes the fixture conventions.

## Test layers

| Layer | Command | Rule |
| --- | --- | --- |
| Fast | `deno task test` | The suite runs with `--allow-read` only. A test starts no subprocess, and it runs in under one second. |
| Slow | `deno task test:slow` | A test file is named `*_slow_test.ts`. A test can start a subprocess. |
| Gate | `deno task check` | The task runs the format check, the lint, the type check, and both suites. Run it before each commit. |
| Installation | `deno task test:installation` | The task checks reproducible packaging and offline installation. |
| Editor | `deno task test:vscode` | The task runs installed VSIX acceptance in a local VS Code application. |
| Browser | Playwright MCP | A person or an agent runs a real user flow against the running page. |

A fast test time varies with machine load, so one run proves little. To check the one-second rule, run the fast suite three times, and keep the minimum of each test.

## Time in tests

A test must not assert wall-clock time. The result of such a test depends on machine load, and a failure then does not mean a defect. A test that measures a delay runs under `TestClock` from `effect/testing`, and it asserts the exact value. See `tests/retry_options_slow_test.ts` and `tests/repeat_slow_test.ts`.

A real timer is acceptable in one case: two timers race, and they start together. Their order then stays the same under load. A lower bound on elapsed time is also acceptable, because a timer does not fire early.

## Oracles

Each oracle covers a limited set of inputs. A pass proves the result for those inputs only.

The independent validator is a test oracle. No product path runs it, and no entry point exports it. A test imports `validateProject` from `src/core/validate_project.ts`. A test that holds a revision calls `validateRevision` in `tests/validate_helpers.ts`. A test that builds a directory calls `validationProblems` in the same file.

| Oracle | Update task | What it proves | What it can miss |
| --- | --- | --- | --- |
| Golden files in `fixtures/golden/` | `deno task golden:update` | The exact TypeScript of six example modules and their host module | Each other program |
| Mutation fixtures in `fixtures/validate/` | `deno task validate:update` | The validator rejects each forged IR in the fixture list | A forged form that the list does not hold |
| Surface snapshot in `fixtures/surface/` | `deno task surface:update` | 91 command-line records and 28 language server records | The records run in memory, so process and file behavior stay outside |
| IR snapshot in `fixtures/ir/` | The test file | The wire form of its example | It reaches 30 of the 101 expression kinds |
| Lexer snapshot in `fixtures/lex/` | `deno task lex:update` | The tokens of a random corpus of 20,000 strings | Input that the corpus does not hold |
| Behavior capture | None | Two revisions give equal records for the test inputs | A record holds hashes and a length, with no message and no test name. It sees only its record kinds and the test inputs. |
| Unfired rejection sites | None | A fast test fires each direct validator rejection | The match is textual, so a rejection through another helper is not listed |
| Log replay | None | A logged session gives equal results on the current build | It skips `--tsc` sessions and watch sessions |
| Website IR in `tests/ir_site_slow_test.ts` | `scripts/site_ir.ts` | The sibling `typed-ir.ts` equals the generated text byte for byte, and passes `deno check` alone | A `git archive` export has no sibling, so the test is ignored there |
| Website examples in `tests/website_examples_slow_test.ts` | `fixtures/website-examples.json` | Each website example gives its listed diagnostics, and it builds with `--tsc` | A snippet in an HTML page is not checked. A `git archive` export has no sibling, so the test is ignored there |

An update task writes what the current code gives. So an update can hide a defect. The reviewer must read each fixture diff, and a change needs a reason in the commit.

A capture exits 1 for a missing record, and also for a failed test. So read its summary lines before you read its exit status.

## What the strict target check catches

The strict target check is `deno task effektive build --tsc`. It runs `deno check` on the emitted code with strict mode. The table below states, for each defect class, whether this check catches the defect and which other kept oracle can catch it.

The evidence is the fault injections of the validation of the simplification rebase, in [the plan](plans/2026-11-02-simplification-rebase.md), Section 6, decision SRD2. Fable injected faults into the checker. Astra injected faults into the IR.

| Defect | Strict target check | Other kept oracle |
| --- | --- | --- |
| A contract narrower than the body (a dropped failure or requirement) | Caught: TS2375 at the source line | - |
| A captured global | Caught | - |
| A contract wider than the body | Missed | Golden files, fixtures |
| A false rejection | Missed: the build stops before the check | Fixtures that must compile |
| A non-exhaustive `match` | Caught: the emitted guard takes `never`, so the unmatched variant gives TS2345 | - |
| A wrong execution mode | Missed | The emitter guard in `src/core/emit/expr.ts` |
| A wrong refinement proof | Missed: the type is `number` | Only the validator |
| An `int` literal `1.5` in IR | Missed | Only the validator |
| An extra failure in an inferred contract | Missed | Only the validator |

The check cannot see a wrong value that has a correct type. Do not use a pass of the check as proof of source semantics.

## Retained revisions

`tests/revision_isolation_test.ts` delays queries on retained revisions until after later definition edits. It compares independently validated IR, emitted text, mappings, and editor results with a fresh program. Its table census also checks cached-module reuse across rotating edits. The census bounds visible table identities. It does not measure retained bytes or garbage-collection timing.

## Playground output

`tests/playground_build_test.ts` checks the output-directory guard without deleting repository data. The guard compares complete parent components, so a repository child called `..scratch` stays protected. The slow build test checks supported external output.

## Property tests

A property test generates its inputs from a literal table of seeds, with `makeRandom` from `bench/generate.ts`. It asserts literal counts of each outcome, so it cannot pass with no effective input. A failure message prints the seed and the step.

| File | What it proves | What it can miss |
| --- | --- | --- |
| `tests/incremental_property_test.ts` | Eight seeds each compare 23 incremental revisions with fresh compilation and the older driver. Delayed queries preserve recorded results. | Each generated project has one feature module. Edits cover import policies and compatible host declarations, but exclude arbitrary configuration changes. |
| `tests/type_laws_property_test.ts` | Each generated type fits itself in the checker and validator. Plain assignment is transitive. Checker and validator results agree on generated pairs. | Generated pairs can omit rare shapes. Directed tests cover selected nominal, function, fiber, sealed, schema, and null boundaries. |
| `tests/predicates_property_test.ts` | Brute force confirms each `proved` and `disproved` result on a bounded domain. `verifyCertificate` accepts each certificate. `and` and `or` obey the identity and absorption laws. | The test does not judge an `unknown` result. |
| `tests/acceptance_property_slow_test.ts` | After seeded token edits, a program that the checker accepts lowers, validates, and emits. | The edits stay near the input programs. Only `.eff` files change. |

A property that fails is a finding about the compiler until the evidence shows otherwise. Do not weaken the property, and do not filter out the input.

`tests/output_characterization_test.ts` checks host reordering with warm, delayed, fresh, and retained revisions.
It compares emitted companion text, maps, span tables, and independent validation.

## Coverage

`deno task coverage` runs both suites with coverage, and it includes child processes through `DENO_COVERAGE_DIR`. It prints a table by directory and the 20 lowest files. The task exits 1 when a floor fails. `deno.json` holds the floors under `coverage.thresholds`.

The gate does not run this task, because it takes several minutes. `deno task release` runs it. A floor can rise. A change that lowers a floor needs a reason in the commit.

Three solver files have sites that no input can reach, so these sites have no test. Each site guards a case that the code around it rules out, and the type checker needs most of them.

| File | Function | Site | Reason |
| --- | --- | --- | --- |
| `src/core/predicates.ts` | `contradiction` | `task === undefined` | The `while` condition holds the list length, so `pop()` returns a task. |
| `src/core/predicates.ts` | `contradiction` | `proof === undefined` | Each finished task adds a proof, and `reduce` handles an empty operand list first. |
| `src/core/predicates.ts` | `reduce` | `current === undefined` | The `while` condition holds the list length, so `pop()` returns an item. |
| `src/core/predicates.ts` | `negativeCycle` | Each `?? 0n` in the relaxation loop | Each node has a first distance before the passes start. |
| `src/core/validate/predicates.ts` | `verifyCertificate` | `task === undefined` | The `while` condition holds the list length, so `pop()` returns a task. |
| `src/core/validate/predicates.ts` | `checkBranch` | `signed === undefined` | The `while` condition holds the list length, so `pop()` returns an item. |
| `src/core/predicate_source.ts` | `termKey` | `case "zero"` | `compileTerm` builds only `input`, `field`, and `length` terms. |
| `src/core/predicate_source.ts` | `compareLinear` | `fail` after `comparison` | Source always gives a valid term and a normalized offset. |

Two groups of sites are probably unreachable, and no proof exists. In `negativeCycle`, the walk back through `predecessor` has three guards. A random run of 30,000 cases did not reach them. In `predicate_source.ts`, three branches guard a missing parse child: a missing `ParamList`, a `Param` with no `Name`, and a field expression with no second child. No tried program reached them, because the parser keeps those nodes during recovery.

Line coverage shows that a line ran. It does not show that a test detects a fault in that line. Use mutation for that.

## Mutation

`deno task mutate` makes small faults in the source, and it runs the tests against each fault. A mutant is one such fault. A survivor is a mutant that the tests do not detect. The tool works in `git archive` copies of the committed `HEAD`, so commit a test before you measure it.

```sh
deno task mutate --seed 1 --sample 6 src/core/types.ts
deno task mutate --seed 1 --sample all --workers 4 src/core/paths.ts
deno task mutate --seed 1 --sample all --tests tests/type_laws_property_test.ts --only src/core/types.ts:1380 src/core/types.ts
```

The tool has four operators: `comparison`, `logical`, `negate-if`, and `boolean-return`. The default test set is the fast suite. A mutant that only a slow test can kill therefore survives by default.

A full run of `src/` is not practical. It has about 11,000 sites, and a run takes hours. So run the tool on the modules that a change touches. The tool does not fit `src/core/emit/` against the fast suite, because the slow suite proves the emitter.

For each survivor, add a test. If no test can kill it, add a row to `fixtures/mutation/survivors.json`. A row holds `file`, `declaration`, `offset`, `text`, `operator`, `class`, and `reason`. Two classes are valid:

- `equivalent`: no input can observe the change.
- `slow-only`: the `reason` names the `*_slow_test.ts` file that kills the mutant.

A row has no line number, so a change outside its declaration does not affect it. A change inside the declaration can make it stale. The tool then exits 1, and a reviewer must check the reason again.

The tool exits 0 when each survivor has a row and each row matches one site. It exits 1 for a survivor with no row, or for a stale row. It exits 2 when the clean run fails, when no test runs, or when the register or the arguments are not valid.
