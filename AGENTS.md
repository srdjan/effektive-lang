# Repository Guidelines

## Project Structure & Module Organization

The core library is in `src/core/`, the command-line tool in `src/cli/`, the host adapters that the command-line tool and the language server share in `src/host/`, and the language server in `src/lsp/`. The VS Code client is in `editors/vscode/`, the browser playground in `playground/`, the measurement harnesses in `bench/`, and the task scripts in `scripts/`. Tests and test helpers are in `tests/`. Test inputs are in `fixtures/`. Design, rules, status, and live plans are in `docs/`. Finished plans and ledgers are in `docs/archive/`. The project status and the application stopping rule are in `docs/status.md`. `docs/development.md` describes each directory and the fixture conventions. Solved problems are recorded in `docs/solutions/<category>/`, with YAML frontmatter (`module`, `problem_type`, `tags`). Shared terms are in `CONCEPTS.md`. Search both before you change a documented area.

## Build, Test, and Development Commands

`docs/development.md` lists the exact commands. Run `deno task check` from the repository root before each commit. It runs the format check, the lint, the type check, and all tests. Use Deno 2.9.8.

## Coding Style & Naming Conventions

Follow the formatter and linter selected for the implementation language, and commit their configuration. Use consistent indentation within each file and descriptive names that reflect each module's purpose. Name files and directories using one convention per language or toolchain. Avoid adding a style rule that the configured tools cannot check unless it is necessary for readability.

## Testing Guidelines

Tests use `Deno.test` and `@std/assert`. A fast test runs in under one second. A test that starts a subprocess goes in a file named `*_slow_test.ts`. Error fixtures follow the marker convention in `docs/development.md`. Do not claim a coverage target until the project adopts one.

## Commit & Pull Request Guidelines

The history uses one commit for each complete unit of work on local `main`. Use a short, imperative subject that explains the change, and a body that gives the reason. Pull requests should summarize the purpose, list the commands used to verify the change, and link related issues when available. Include screenshots for visible interface changes, and call out any setup or configuration changes reviewers need to reproduce.

Each ledger or plan uses its own ID prefix. The registry is [docs/plans/README.md](docs/plans/README.md). Pick a new prefix, and add it to the registry.

When a plan is complete, the commit that completes it moves the plan and its evidence to `docs/archive/plans/`, updates the links, and updates the registry path.

## Agent Orchestration

Before a large task, the orchestrator writes an orchestration plan for subagents. A task is large when it changes more than three files, has two or more independent units, or needs a search across many files. The orchestrator does a smaller task directly, without subagents.

The strongest available model orchestrates. It writes the plan, dispatches each unit, reviews each result, and runs the verification commands. A cheaper model executes each self-contained unit. A strong reviewer model validates a non-trivial plan before execution starts. The model names for each tool are in the global instructions of that tool.

The plan names each unit, its model, its files, its acceptance check, and its turn budget. Each dispatch carries all the context that the executor needs, because the executor cannot see the conversation. When an executor reaches its turn budget, the executor stops and hands back its status and open items. The orchestrator then splits the unit. Each executor returns a short handback: the changed files, the check results, and the open issues. It does not return file contents or full logs.

The orchestrator does not accept an executor claim as evidence. It reviews the diff line by line and runs `deno task check`. For a small defect, the orchestrator fixes the defect directly. For a large defect, it returns the unit to the executor with the specific findings.

Each model request reads the full context again, so a long context costs more on every turn. Read a line range of a large file, not the whole file. Filter command output with `head`, `tail`, or `grep`, and show only failures. Start a new subagent or session for each independent unit. Do not extend one long session.

## Feature Selection & Completion

The self-improvement loop is in [docs/logging.md](docs/logging.md): run `deno task logs:report`, rank the findings in a ledger, and prove each fix with `deno task logs:replay`.

Follow the accepted [application acceptance rule](docs/plans/2026-10-19-application-acceptance-rule.md) when selecting gap work. The stopping rule, the application dispositions, and the open items are in [docs/status.md](docs/status.md). Keep application orchestration in `.eff`. Add features only for demonstrated application blockers after checking existing source compositions. Exception, accepted 2026-10-24: a compiler or syntax change that makes source more terse and elegant is welcome without an application blocker. It must keep the source easy to read, keep closed contracts, and keep explicit exported contracts.

Exception, accepted 2026-10-27: Effektive hides the verbosity of Effect. Expose an Effect feature in source only when it carries user intent that the compiler cannot infer. Use every other Effect feature inside the transpiler only. Prefer to extend an existing source form over adding a builtin name. The candidate list is in [docs/status.md](docs/status.md#effect-4-features-to-surface-in-source).

The website and canonical spec are in the sibling repository `../effektive/public/`.
When a change affects source forms or project status, keep the website specification and its examples current.
Verify changed Effektive examples with the compiler. Run the site's strict checks for TypeScript panels.
Commit website edits separately in that repository.
