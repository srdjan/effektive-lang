// Tests the git hooks in `.githooks/` in temporary git repositories. A test
// starts git and Deno, so the file is slow.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { withTemporaryDirectory } from "./process_helpers.ts";

const HOOKS = fromFileUrl(new URL("../.githooks", import.meta.url));

const CONFIG = '{\n  "version": "0.1.0"\n}\n';
const BUMPED_CONFIG = '{\n  "version": "0.2.0"\n}\n';
const CHANGELOG =
  "# Changelog\n\n## Unreleased\n\n- A change.\n\n## 0.1.0 - 2026-01-01\n\n- First.\n";
const EMPTY_CHANGELOG =
  "# Changelog\n\n## Unreleased\n\n## 0.1.0 - 2026-01-01\n\n- First.\n";
const RELEASED_CHANGELOG =
  "# Changelog\n\n## Unreleased\n\n## 0.2.0 - 2026-11-10\n\n- A change.\n\n## 0.1.0 - 2026-01-01\n\n- First.\n";

interface Git {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function git(dir: string, args: readonly string[]): Promise<Git> {
  const output = await new Deno.Command("git", {
    args: [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    cwd: dir,
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      EFFEKTIVE_HOOK_DATE: "2026-11-10",
      NO_COLOR: "1",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

/** Makes a repository with one commit and the hooks active. */
async function repository(dir: string, changelog: string): Promise<void> {
  Deno.writeTextFileSync(`${dir}/deno.json`, CONFIG);
  Deno.writeTextFileSync(`${dir}/CHANGELOG.md`, changelog);
  await git(dir, ["init", "-q"]);
  await git(dir, ["add", "."]);
  await git(dir, ["commit", "-q", "-m", "first"]);
  await git(dir, ["config", "core.hooksPath", HOOKS]);
}

async function committed(dir: string, path: string): Promise<string> {
  return (await git(dir, ["show", `HEAD:${path}`])).stdout;
}

Deno.test("git commit -am completes a bare version commit", () =>
  withTemporaryDirectory("version-hook-", async (dir) => {
    await repository(dir, CHANGELOG);
    Deno.writeTextFileSync(`${dir}/deno.json`, BUMPED_CONFIG);
    const commit = await git(dir, ["commit", "-q", "-am", "v0.2.0"]);
    assertEquals(commit.code, 0, commit.stderr);
    assertEquals(
      commit.stderr,
      "version hook: CHANGELOG.md has the new heading ## 0.2.0 - 2026-11-10\n",
    );
    assertEquals(await committed(dir, "CHANGELOG.md"), RELEASED_CHANGELOG);
    assertEquals((await git(dir, ["status", "--porcelain"])).stdout, "");
  }));

Deno.test("a version commit whose changelog has the heading already keeps it", () =>
  withTemporaryDirectory("version-hook-", async (dir) => {
    await repository(dir, CHANGELOG);
    Deno.writeTextFileSync(`${dir}/deno.json`, BUMPED_CONFIG);
    Deno.writeTextFileSync(`${dir}/CHANGELOG.md`, RELEASED_CHANGELOG);
    const commit = await git(dir, ["commit", "-q", "-am", "v0.2.0"]);
    assertEquals(commit.code, 0, commit.stderr);
    assertEquals(commit.stderr, "");
    assertEquals(await committed(dir, "CHANGELOG.md"), RELEASED_CHANGELOG);
  }));

Deno.test("a path-limited commit completes a bare version commit", () =>
  withTemporaryDirectory("version-hook-", async (dir) => {
    await repository(dir, CHANGELOG);
    Deno.writeTextFileSync(`${dir}/deno.json`, BUMPED_CONFIG);
    const commit = await git(dir, [
      "commit",
      "-q",
      "deno.json",
      "-m",
      "v0.2.0",
    ]);
    assertEquals(commit.code, 0, commit.stderr);
    assertEquals(await committed(dir, "CHANGELOG.md"), RELEASED_CHANGELOG);
    assertEquals((await git(dir, ["status", "--porcelain"])).stdout, "");
  }));

Deno.test("a version bump with an empty Unreleased section fails the commit", () =>
  withTemporaryDirectory("version-hook-", async (dir) => {
    await repository(dir, EMPTY_CHANGELOG);
    const before = (await git(dir, ["rev-parse", "HEAD"])).stdout;
    Deno.writeTextFileSync(`${dir}/deno.json`, BUMPED_CONFIG);
    const commit = await git(dir, ["commit", "-q", "-am", "v0.2.0"]);
    assertEquals(commit.code, 1);
    assertStringIncludes(
      commit.stderr,
      "release: Unreleased has no entries in CHANGELOG.md",
    );
    assertEquals((await git(dir, ["rev-parse", "HEAD"])).stdout, before);
  }));

Deno.test("a commit without a version change keeps the changelog", () =>
  withTemporaryDirectory("version-hook-", async (dir) => {
    await repository(dir, CHANGELOG);
    Deno.writeTextFileSync(`${dir}/notes.txt`, "notes\n");
    await git(dir, ["add", "notes.txt"]);
    const commit = await git(dir, ["commit", "-q", "-m", "notes"]);
    assertEquals(commit.code, 0, commit.stderr);
    assertEquals(await committed(dir, "CHANGELOG.md"), CHANGELOG);
  }));
