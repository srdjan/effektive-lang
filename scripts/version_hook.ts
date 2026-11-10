// Completes a bare version commit. The git hook `.githooks/pre-commit` runs
// this script when a commit changes `version` in deno.json. When the newest
// versioned heading of the staged CHANGELOG.md already equals the new version,
// the script does nothing. Otherwise it moves the entries of "Unreleased"
// under the heading `## <version> - <date>` with `releaseTexts` from
// `scripts/release.ts`, writes CHANGELOG.md, and stages it. The script works
// on the current directory, which is the repository that git commits. It exits
// 1 when the working-tree CHANGELOG.md differs from the staged one, and when
// `releaseTexts` refuses. It writes the marker `version-hook-staged` in the git
// directory so that `.githooks/post-commit` can repair the index. The date is
// the UTC date of today, or the value of EFFEKTIVE_HOOK_DATE (a test seam).

import type { Result } from "../src/core/mod.ts";
import { describe, releaseTexts } from "./release.ts";
import { runProcess } from "./lib.ts";

const VERSIONED_HEADING = /^## (\d+\.\d+\.\d+) - /m;
const CONFIG_VERSION = /^ {2}"version": "(\d+\.\d+\.\d+)"/m;

async function git(args: string[]): Promise<Result<string, string>> {
  const output = await runProcess("git", args);
  return output.success
    ? { ok: true, value: output.stdout }
    : { ok: false, error: `version hook: git ${args.join(" ")} failed` };
}

function versionOf(config: string): string | undefined {
  return CONFIG_VERSION.exec(config)?.[1];
}

async function complete(): Promise<Result<string | undefined, string>> {
  const headConfig = await git(["show", "HEAD:deno.json"]);
  if (!headConfig.ok) return headConfig;
  const stagedConfig = await git(["show", ":deno.json"]);
  if (!stagedConfig.ok) return stagedConfig;
  const staged = await git(["show", ":CHANGELOG.md"]);
  if (!staged.ok) return staged;
  const version = versionOf(stagedConfig.value);
  if (version === undefined) {
    return { ok: false, error: "version hook: no version in staged deno.json" };
  }
  if (VERSIONED_HEADING.exec(staged.value)?.[1] === version) {
    return { ok: true, value: undefined };
  }
  const working = await Deno.readTextFile("CHANGELOG.md");
  if (working !== staged.value) {
    return {
      ok: false,
      error:
        "version hook: CHANGELOG.md has edits that are not staged. Stage or stash the changelog edits first.",
    };
  }
  const configured = Deno.env.get("EFFEKTIVE_HOOK_DATE");
  const date = configured === undefined || configured === ""
    ? new Date().toISOString().slice(0, 10)
    : configured;
  const texts = releaseTexts(
    staged.value,
    headConfig.value,
    version,
    date,
  );
  if (!texts.ok) return { ok: false, error: describe(texts.error) };
  await Deno.writeTextFile("CHANGELOG.md", texts.value.changelog);
  const added = await git(["add", "CHANGELOG.md"]);
  if (!added.ok) return added;
  const gitDir = await git(["rev-parse", "--git-dir"]);
  if (!gitDir.ok) return gitDir;
  await Deno.writeTextFile(
    `${gitDir.value.trim()}/version-hook-staged`,
    "",
  );
  return { ok: true, value: `## ${version} - ${date}` };
}

async function main(): Promise<number> {
  const result = await complete();
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  if (result.value !== undefined) {
    console.log(
      `version hook: CHANGELOG.md has the new heading ${result.value}`,
    );
  }
  return 0;
}

if (import.meta.main) Deno.exit(await main());
