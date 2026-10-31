// Prepares a release in one step. Run `deno task release <version>`, where
// <version> is `X.Y.Z`. The task moves the entries of "Unreleased" in
// CHANGELOG.md under a new heading `## <version> - <date>`, with today's UTC
// date. It sets `version` in deno.json to <version>. Then it runs
// `deno task check`. When the check fails, the script writes the original
// texts back and exits 1. The script refuses to run on a dirty working tree.
// It exits 2 when the version argument is missing. It never commits and never
// pushes: the maintainer commits with the subject `vX.Y.Z` and pushes.

import { dirname, fromFileUrl, join } from "@std/path";
import type { Result } from "../src/core/mod.ts";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const VERSION_TEXT = /^\d+\.\d+\.\d+$/;
const CONFIG_VERSION = /^( {2}"version": ")(\d+\.\d+\.\d+)(")/m;
const UNRELEASED = "## Unreleased\n";

/** The reasons that `releaseTexts` refuses a release. */
export type ReleaseError =
  | { readonly tag: "bad-version"; readonly version: string }
  | { readonly tag: "no-unreleased-heading" }
  | { readonly tag: "empty-unreleased" }
  | { readonly tag: "no-config-version" }
  | {
    readonly tag: "not-rising";
    readonly version: string;
    readonly current: string;
  };

/** The new texts of CHANGELOG.md and deno.json. */
export type ReleaseTexts = {
  readonly changelog: string;
  readonly config: string;
};

function parts(version: string): number[] {
  return version.split(".").map(Number);
}

function rises(version: string, current: string): boolean {
  const next = parts(version);
  const old = parts(current);
  for (let i = 0; i < 3; i++) {
    if (next[i] !== old[i]) return next[i] > old[i];
  }
  return false;
}

/**
 * Computes the texts of a release. The changelog gets the heading
 * `## <version> - <date>` with the entries of "Unreleased", and the text after
 * the entries stays unchanged. The config gets the new `version` by a text
 * replacement of one line.
 */
export function releaseTexts(
  changelog: string,
  config: string,
  version: string,
  date: string,
): Result<ReleaseTexts, ReleaseError> {
  if (!VERSION_TEXT.test(version)) {
    return { ok: false, error: { tag: "bad-version", version } };
  }
  // A match in the text with a leading newline starts at the same index in
  // the changelog.
  const start = `\n${changelog}`.indexOf(`\n${UNRELEASED}`);
  if (start === -1) {
    return { ok: false, error: { tag: "no-unreleased-heading" } };
  }
  const bodyStart = start + UNRELEASED.length;
  const next = changelog.indexOf("\n## ", bodyStart - 1);
  const bodyEnd = next === -1 ? changelog.length : next + 1;
  const entries = changelog.slice(bodyStart, bodyEnd).trim();
  if (entries === "") {
    return { ok: false, error: { tag: "empty-unreleased" } };
  }
  const found = CONFIG_VERSION.exec(config);
  if (found === null) {
    return { ok: false, error: { tag: "no-config-version" } };
  }
  const current = found[2];
  if (!rises(version, current)) {
    return { ok: false, error: { tag: "not-rising", version, current } };
  }
  const rest = changelog.slice(bodyEnd);
  const section = `## ${version} - ${date}\n\n${entries}\n`;
  return {
    ok: true,
    value: {
      changelog: `${changelog.slice(0, bodyStart)}\n${section}${
        rest === "" ? "" : `\n${rest}`
      }`,
      config: config.replace(CONFIG_VERSION, `$1${version}$3`),
    },
  };
}

function describe(error: ReleaseError): string {
  switch (error.tag) {
    case "bad-version":
      return `release: "${error.version}" is not a version of the form X.Y.Z`;
    case "no-unreleased-heading":
      return "release: CHANGELOG.md has no `## Unreleased` heading";
    case "empty-unreleased":
      return "release: Unreleased has no entries in CHANGELOG.md";
    case "no-config-version":
      return 'release: deno.json has no `  "version": "X.Y.Z"` line';
    case "not-rising":
      return `release: ${error.version} does not rise above ${error.current}`;
  }
}

async function git(args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd: ROOT,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  return new TextDecoder().decode(output.stdout);
}

async function main(): Promise<number> {
  const version = Deno.args[0];
  if (version === undefined) {
    console.error("usage: deno task release <version>  (version is X.Y.Z)");
    return 2;
  }
  if ((await git(["status", "--porcelain"])).trim() !== "") {
    console.error(
      "release: the working tree is dirty. Commit or stash the changes first.",
    );
    return 1;
  }
  const changelogPath = join(ROOT, "CHANGELOG.md");
  const configPath = join(ROOT, "deno.json");
  const changelog = await Deno.readTextFile(changelogPath);
  const config = await Deno.readTextFile(configPath);
  const date = new Date().toISOString().slice(0, 10);
  const texts = releaseTexts(changelog, config, version, date);
  if (!texts.ok) {
    console.error(describe(texts.error));
    return 1;
  }
  await Deno.writeTextFile(changelogPath, texts.value.changelog);
  await Deno.writeTextFile(configPath, texts.value.config);
  const check = await new Deno.Command("deno", {
    args: ["task", "check"],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!check.success) {
    await Deno.writeTextFile(changelogPath, changelog);
    await Deno.writeTextFile(configPath, config);
    console.error(
      "release: deno task check failed. CHANGELOG.md and deno.json are restored.",
    );
    return 1;
  }
  console.log(
    `release: ${version} is ready. Review the diff, commit with the subject v${version}, then push.`,
  );
  return 0;
}

if (import.meta.main) Deno.exit(await main());
