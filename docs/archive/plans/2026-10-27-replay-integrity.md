# Replay integrity repairs

The user authorized both repairs on 2026-10-27 after the architectural review.
The starting revision is `80ff058`.
The prefix LR means logging replay repairs.

## Objective and constraints

I will preserve playground event order and retain source blobs while retained sessions reference them.
I will keep the existing log format, public page API, off flags, and failure behavior.
I will work on local `main` and commit each repair separately.
I will not push commits.

## LR1: preserve playground request order

The client starts all split requests concurrently in `playground/src/log_client.ts`.
The server appends each request after its body completes in `playground/serve.ts`.
The replay readers consume file order.
The review probe accepted two requests in reverse order and reconstructed different source text.

I will serialize posts across batches and later flushes through one promise chain.
I will preserve immediate submission of the first request and stop queued submissions after a failure.
I will test controlled responses, subsequent flushes, and replayed edit order in `tests/playground_log_client_test.ts`.
I will update `docs/logging.md` with the ordering contract.

## LR2: preserve referenced source blobs

`prepareLogFolder` deletes sessions and blobs independently by modification time in `src/host/log.ts`.
The review probe retained an active session but deleted its source blob after eight simulated days.
Replay then returned `unsupported` because the blob was missing.

I will read retained sessions before deleting old blobs and preserve their referenced hashes.
I will retain blobs when a session cannot be read or parsed, or the session listing fails.
I will retain references from an old session when its removal fails.
I will add reading to `LogFs` and its existing real and memory adapters.
I will test replay after cleanup, later reclamation, and cleanup failures.
I will update the rotation documentation and the real-disk test.

## Verification and stopping conditions

I will run each regression before its repair and record the observed failure.
I will run focused tests after each repair, followed by `deno task check` before each commit.
I will inspect every changed line and confirm that the working tree contains only the planned changes.
I will stop for an unrelated destructive change, unavailable required dependency, or a script that exceeds two minutes.
The repairs require no source-form or website specification change.

## Worklog

Completed: the review reproduced both failures through public APIs and in-memory adapters.
LR1 regressions failed before the repair: concurrent requests started before the previous response.
LR1 now serializes requests and stops queued batches after a failure.
LR1 verification: all 24 focused tests and `deno task check` passed, including all 213 slow tests.
LR1 commit: `e032669`.
LR2 regressions failed before the repair: replay returned `unsupported`, and cleanup deleted sources when session evidence was unavailable.
LR2 now marks references from retained sessions before deleting old blobs.
Cleanup keeps blobs when session evidence is unavailable or an expired session cannot be removed.
LR2 verification: all 40 focused tests and the real-disk test passed.
The retention regression replayed a recorded CLI session with result `same` after cleanup.
The regression also confirmed later reclamation after the retained session expired.
LR2 verification: `deno task check` passed, including all 213 slow tests.
Completed: both repairs, regression checks, documentation, and the plan archive.
Remaining: the user owns review and push of the local commits.
