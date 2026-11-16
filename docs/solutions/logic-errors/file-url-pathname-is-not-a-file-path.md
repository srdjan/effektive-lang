---
title: The pathname of a file URL is not a file system path
date: 2026-11-16
category: logic-errors
module: bench/lsp_script.ts
problem_type: logic_error
component: testing_framework
symptoms:
  - "A folder whose name has a space gives a `URL.pathname` with `%20`, and `Deno.readDirSync` of that path throws `NotFound`"
  - "No test fails, because no checkout path in use has a character that URL encoding changes"
root_cause: wrong_api
resolution_type: code_fix
severity: low
tags: [file-url, pathname, fromfileurl, import-meta-url, percent-encoding, bench, tests]
---

# The pathname of a file URL is not a file system path

## Problem

A cleanup unit of the second fresh-eyes review changed `loadInput` in `bench/lsp_script.ts`. The new code read the examples folder through `new URL("../fixtures/examples", import.meta.url).pathname`. `URL.pathname` keeps the percent-encoding of the URL. So in a checkout whose path has a space or another escaped character, the bench reads a folder that does not exist.

## Symptoms

- A probe on Deno 2.9.8 made a temporary folder whose name starts with `a b`. For `examples` in that folder, `URL.pathname` gave `.../a%20b.../examples`, and `Deno.readDirSync` of that path threw `NotFound`. `fromFileUrl` gave `.../a b.../examples`, and the same read succeeded.
- The fast gate and the bench slow tests passed with the defect.

## What Didn't Work

The gates could not see the defect. The repository path in use has no character that URL encoding changes, so `pathname` and the real path were the same string. The executor's gate and the orchestrator's gate both passed. Only a line-by-line review of the diff found the defect.

A test for the fix needs a repository path with a space, so the fix has no test.

## Solution

The commit "Read the bench examples through fromFileUrl" converts the URL with `fromFileUrl` from `@std/path`:

```ts
// Before: keeps %20 for a space.
new URL("../fixtures/examples", import.meta.url).pathname,

// After: a real file system path.
import { fromFileUrl } from "@std/path";
fromFileUrl(new URL("../fixtures/examples", import.meta.url)),
```

## Why This Works

`URL.pathname` is the path part of the URL in its encoded form. It is correct for routing or for a compare with another URL path, but it is not a file system path. `fromFileUrl` decodes the percent-encoding, so its result is a path that `Deno` file APIs accept.

## Prevention

- To get a file system path from a module URL, use `fromFileUrl(new URL(relative, import.meta.url))`. Use `.pathname` only for a URL path, such as the request path of a server.
- The repository still has both forms. On 2026-11-16, 10 places pass `.pathname` of a file URL to the file system: `bench/m5_target.ts:93` and 9 path values in test files, for example `tests/cli_slow_test.ts:17` and `tests/behavior_compare_slow_test.ts:7`. A copy of one of these lines brings the defect back. A change of these 10 places to `fromFileUrl` removes the second form. That change is work for the owner of the tests and the bench.
- In a review, look for `.pathname` on a URL that comes from `import.meta.url`.

## Related Issues

- [Second fresh-eyes review](../../archive/plans/2026-11-16-fresh-eyes-review.md), unit FZU15, records the regression and the fix.
