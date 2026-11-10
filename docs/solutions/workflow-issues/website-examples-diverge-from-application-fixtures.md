---
title: A website example can differ from its application fixture
date: 2026-11-10
category: workflow-issues
module: fixtures/applications
problem_type: workflow_issue
component: documentation
severity: medium
applies_when:
  - "A plan says to copy an application fixture to ../effektive/public/effektive-examples/"
  - "A change edits a .eff file in fixtures/applications/ that also has a website copy"
tags: [website, examples, fixtures, service-headers, copy, regression]
---

# A website example can differ from its application fixture

## Context

Each gate application has two source copies. The compiler copy is in
`fixtures/applications/<name>/`. The website copy is in
`../effektive/public/effektive-examples/<name>/`. Plan text often says that a unit
copies the fixture to the website, for example COU6 of the core data operations plan.

The copies are not the same. Website commit `d7a1095` ("Infer example requirements
from service headers") changed only the website copies to the terse form: `imports`
service headers and an inferred `with` clause. The compiler fixtures keep one plain
`import` and a written `with` clause. On 2026-11-10, three website examples differed
from their fixtures. The paths are under `../effektive/public/effektive-examples/`:
`scheduled-worker/worker.eff` by 7 diff lines,
`service-workflow/workflow.eff` by 9, and `stream-processor/processor.eff` by 8. Both
copies of `order-lifecycle` were the same.

## What went wrong

In CPU5 of phase 2, an executor copied `fixtures/applications/stream-processor/processor.eff`
over the website copy to carry a one-line change to `len(batch) > 0`. The copy also
removed the service headers and added back the written `with` clause. Every check
passed: the website `deno task test` and `deno task typecheck`, and the compiler test
`tests/website_examples_slow_test.ts`. Both forms are valid source, so no check can see
the regression. Opus found it in the review of the diff.

## Guidance

To carry a fixture change to a website example, apply the same edit to the website
file. Do not copy the file. Then run `git -C ../effektive diff` on the example and
confirm that only the intended lines changed. When a plan says "copy", read it as
"apply the same change".

## Prevention

The root cause is two owners of one example. A fix that stops the repeat is one source
of truth: either the fixtures adopt the service headers of `d7a1095`, so a copy is
safe, or a test asserts that each website example and its fixture are the same. Either
change edits product files, so it needs a decision of the user.
