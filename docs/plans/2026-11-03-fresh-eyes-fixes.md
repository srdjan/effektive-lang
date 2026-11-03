# Fresh-eyes fixes

Date: 2026-11-03. Status: approved for local execution.
FE identifies the five phases. FEF identifies the confirmed findings.
The [evidence file](2026-11-03-fresh-eyes-fixes-evidence.md) holds progress, checks, and open issues.

## Objective and authority

Repair the seven confirmed findings from the fresh-eyes review.
Keep each phase independently reviewable and commit each complete phase on local `main`.
The user accepted this order and authorized implementation, verification, and local commits.
The user selected rejection of source symlinks that resolve outside the project root.
Do not push, publish, or change deferred language work.

## Confirmed findings

| Finding | Evidence | Required result |
| --- | --- | --- |
| FEF1: unsafe playground cleanup | `playground/build.ts` checks lexical paths before recursive deletion. A symlinked parent bypasses the guard. | Resolve filesystem targets before deletion. Protect the repository and its parents. |
| FEF2: external project writes | File symlinks bypass directory containment. Source fixes and generated maps can overwrite external files. | Reject external source targets and block external output writes. |
| FEF3: release metadata mismatch | `deno.json` declares 0.13.0. The newest changelog heading is 0.12.3. | Restore agreement without changing the declared release. |
| FEF4: source-map numeric overflow | Large negative safe integers lose their sign. Overlong VLQ input can decode to `NaN` with success. | Preserve safe integers exactly and return tagged errors for overflow. |
| FEF5: validation documentation | `docs/language-rules.md` denies the producer comparison that `validateProject` performs. | State the comparison and its exceptions. |
| FEF6: interface hash documentation | An inferred input edit changes the interface hash without changing execution mode. | Describe exported contract changes as hash inputs. |
| FEF7: compiler target documentation | The active acceptance rule names Deno 2.9.7. Current instructions and packaging require 2.9.8. | Distinguish the historical baseline from the current requirement. |
| FEF8: baseline command permissions | The complete gate exposed a Deno command mismatch after a symlinked executable starts a child process. | Use the `deno` command that the task explicitly permits. |
| FEF9: accumulated map positions | Independent review found that valid VLQ deltas can accumulate into unsafe absolute positions. | Reject overflow in generated, source, line, and column positions. |

## Execution units

The main agent reviews every diff and runs authoritative checks.
Only Sol subagents with high reasoning effort may execute delegated units.
Each delegated unit has a limit of 20 turns and returns files, checks, and open issues.
The phase order is a user decision. Units therefore run in order.

### FE1: restore the baseline

Owner: main agent. Budget: 10 turns.
Files: `CHANGELOG.md`, `scripts/behavior_compare.ts`, this plan, its evidence file, and `docs/plans/README.md`.
Add the missing 0.13.0 heading with facts from the local release history.
Register this plan and record the accepted decisions.
Use the existing failing documentation test as the initial proof.
Use the two failing behavior-comparison tests to repair the discovered baseline permission mismatch.
Acceptance: `deno test --allow-read tests/docs_test.ts` and `deno task check` pass.

### FE2: protect playground cleanup

Owner: main agent. Budget: 20 turns.
Files: `playground/build.ts`, `tests/playground_build_test.ts`, and `tests/playground_build_slow_test.ts`.
Resolve existing path components before deciding whether deletion is safe.
Protect repository directories and ancestors reached through aliases.
Keep normal external output and `playground/dist` supported.
Use temporary repositories or filesystem doubles for destructive regression probes.
Acceptance: existing guard tests and real symlink regression tests pass.
Run `deno task check` and targeted mutation for `playground/build.ts`.

### FE3: contain project writes

Owner: Sol (`gpt-5.6-sol`, high). Budget: 20 turns.
Files: `src/host/io.ts`, `src/host/deno_io.ts`, `src/host/workspace.ts`, `src/host/outputs.ts`, and `src/cli/main.ts`.
Tests: workspace, generated-output, CLI-fix, save-round, and filesystem tests as needed.
Port wrappers and their doubles may change when the filesystem port needs a no-follow link check.
A small shared host helper is permitted when it removes duplicate containment checks.
Update the source map in `docs/api.md` if a new file is necessary.
Reject source symlinks outside the resolved root with an expected error.
Check each `.ts` and `.ts.map` target before writing output.
Cover existing and dangling links with a no-follow check before resolving their targets.
Check existing parent directories before writing new output.
Apply the same containment rule to CLI fixes and shared output writes.
Keep normal files, internal links, nested projects, stale removal, and disk-based save rounds working.
Acceptance: external source targets remain unchanged after a refused fix.
Existing and dangling external `.ts` and `.ts.map` targets remain unchanged or absent in real filesystem regressions.
Run focused public CLI and host tests, then `deno task check`.
Run targeted mutation on changed logic, using relevant fast or slow tests.

### FE4: correct numeric encoding

Owner: main agent. Budget: 20 turns.
Files: `src/core/emit/sourcemap.ts`, `tests/sourcemap_test.ts`, and `tests/sourcemap_overflow_test.ts`.
Preserve the accepted domain of safe integer inputs.
Use exact intermediate arithmetic for sign packing and decoding.
Reject decoded values outside that domain through a tagged error.
Add public API regressions for both signs, numeric boundaries, overflow, and existing ordinary mappings.
Acceptance: boundary round trips and malformed input tests pass.
Run `deno task check` and targeted mutation for `src/core/emit/sourcemap.ts`.

### FE5: align live documentation

Owner: main agent. Budget: 15 turns.
Files: `docs/language-rules.md`, `docs/plans/2026-10-19-application-acceptance-rule.md`, and related host documentation where behavior changed.
Correct the producer comparison, interface hash, and compiler target statements.
Describe the accepted filesystem policy without claiming protection against concurrent filesystem replacement.
Do not change language forms, the IR, application acceptance, or explicit deferrals.
Run the documentation tests and `deno task check`.
Move this completed plan and its evidence to `docs/archive/plans/` in the completing commit.
Update their links and the registry path.

## Verification and stop conditions

Start each logic repair with a focused failing regression when practical.
Use public entry points for behavior tests and simple filesystem doubles for fast tests.
Run `deno task check` before each commit.
Mutation reads committed `HEAD`, so run it after the corresponding local commit.
If mutation requires a correction, commit the correction after the complete check and repeat the selected mutation.
Do not mark a logic phase complete until its selected mutation check passes.
Start with a small mutation sample before selecting more sites.
Record the tested sites and tests; a sample does not prove every mutation site.
Keep accepted survivor rows intact unless changed logic makes a row stale.
Do not alter an oracle or its expectations to hide a failure.
Stop for a genuine blocker, a required scope change, sudo, or a script that exceeds two minutes.
Use short tool waits so progress remains visible.

## Completion

All five phases must have their changes, checks, and local commits recorded.
No external target may change in the filesystem regression tests.
The complete check must pass on the final tree.
Unrun browser, installed-editor, and concurrency checks remain explicit evidence limits.
