import { assertEquals } from "@std/assert";
import { describe, releaseTexts } from "../scripts/release.ts";

const CONFIG = `{
  "name": "@x/y",
  "version": "0.9.9",
  "license": "MIT"
}
`;

const CHANGELOG = `# Changelog

## Unreleased

- First entry.
- Second entry
  with a second line.

## 0.9.9 - 2026-10-01

- Older entry.
`;

const HEADING_ONLY = `# Changelog

## Unreleased

## 0.9.9 - 2026-10-01

- Older entry.
`;

const BLANK_ONLY = `# Changelog

## Unreleased


## 0.9.9 - 2026-10-01

- Older entry.
`;

const LAST_SECTION = `# Changelog

## Unreleased

- Only entry.
`;

type Case = {
  readonly name: string;
  readonly changelog: string;
  readonly config: string;
  readonly version: string;
  readonly expected: ReturnType<typeof releaseTexts>;
};

const CASES: readonly Case[] = [
  {
    name: "moves the entries under the new heading",
    changelog: CHANGELOG,
    config: CONFIG,
    version: "0.10.0",
    expected: {
      ok: true,
      value: {
        changelog: `# Changelog

## Unreleased

## 0.10.0 - 2026-11-01

- First entry.
- Second entry
  with a second line.

## 0.9.9 - 2026-10-01

- Older entry.
`,
        config: `{
  "name": "@x/y",
  "version": "0.10.0",
  "license": "MIT"
}
`,
      },
    },
  },
  {
    name: "moves entries when Unreleased is the last section",
    changelog: LAST_SECTION,
    config: CONFIG,
    version: "1.0.0",
    expected: {
      ok: true,
      value: {
        changelog: `# Changelog

## Unreleased

## 1.0.0 - 2026-11-01

- Only entry.
`,
        config: `{
  "name": "@x/y",
  "version": "1.0.0",
  "license": "MIT"
}
`,
      },
    },
  },
  {
    name: "rejects an empty Unreleased section",
    changelog: HEADING_ONLY,
    config: CONFIG,
    version: "0.10.0",
    expected: { ok: false, error: { tag: "empty-unreleased" } },
  },
  {
    name: "rejects a whitespace-only Unreleased section",
    changelog: BLANK_ONLY,
    config: CONFIG,
    version: "0.10.0",
    expected: { ok: false, error: { tag: "empty-unreleased" } },
  },
  {
    name: "rejects an equal version",
    changelog: CHANGELOG,
    config: CONFIG,
    version: "0.9.9",
    expected: {
      ok: false,
      error: { tag: "not-rising", version: "0.9.9", current: "0.9.9" },
    },
  },
  {
    name: "rejects a lower version",
    changelog: CHANGELOG,
    config: CONFIG,
    version: "0.9.8",
    expected: {
      ok: false,
      error: { tag: "not-rising", version: "0.9.8", current: "0.9.9" },
    },
  },
  {
    name: "rejects a version text that is not X.Y.Z",
    changelog: CHANGELOG,
    config: CONFIG,
    version: "1.0",
    expected: { ok: false, error: { tag: "bad-version", version: "1.0" } },
  },
  {
    name: "rejects a changelog without the Unreleased heading",
    changelog: "# Changelog\n\n## 0.9.9 - 2026-10-01\n\n- Older entry.\n",
    config: CONFIG,
    version: "0.10.0",
    expected: { ok: false, error: { tag: "no-unreleased-heading" } },
  },
  {
    name: "rejects a config without a version line",
    changelog: CHANGELOG,
    config: '{\n  "name": "@x/y"\n}\n',
    version: "0.10.0",
    expected: { ok: false, error: { tag: "no-config-version" } },
  },
];

for (const c of CASES) {
  Deno.test(`releaseTexts ${c.name}`, () => {
    assertEquals(
      releaseTexts(c.changelog, c.config, c.version, "2026-11-01"),
      c.expected,
    );
  });
}

Deno.test("describe writes one text for each release error", () => {
  assertEquals(
    describe({ tag: "bad-version", version: "1.0" }),
    'release: "1.0" is not a version of the form X.Y.Z',
  );
  assertEquals(
    describe({ tag: "no-unreleased-heading" }),
    "release: CHANGELOG.md has no `## Unreleased` heading",
  );
  assertEquals(
    describe({ tag: "empty-unreleased" }),
    "release: Unreleased has no entries in CHANGELOG.md",
  );
  assertEquals(
    describe({ tag: "no-config-version" }),
    'release: deno.json has no `  "version": "X.Y.Z"` line',
  );
  assertEquals(
    describe({ tag: "not-rising", version: "0.9.8", current: "0.9.9" }),
    "release: 0.9.8 does not rise above 0.9.9",
  );
});
