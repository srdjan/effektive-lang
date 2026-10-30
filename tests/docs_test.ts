// Guards for the live documents: every relative link resolves, and the source
// file map in docs/api.md names every source file by its repository path.

import { assert, assertEquals } from "@std/assert";

const ROOT = new URL("../", import.meta.url);
// `demos` and `.playwright-mcp` hold local, gitignored artifacts.
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".claude",
  ".playwright-mcp",
  "demos",
]);

/** Repository-relative paths of the files under `dir` that pass `keep`. */
async function walk(
  dir: string,
  keep: (path: string) => boolean,
  skip: (path: string) => boolean = () => false,
): Promise<string[]> {
  const found: string[] = [];
  const base = new URL(dir === "" ? "./" : `${dir}/`, ROOT);
  for await (const entry of Deno.readDir(base)) {
    const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name) || skip(path)) continue;
      found.push(...await walk(path, keep, skip));
    } else if (entry.isFile && keep(path)) {
      found.push(path);
    }
  }
  return found;
}

Deno.test("every relative link in a live Markdown file resolves", async () => {
  const files = await walk(
    "",
    (path) => path.endsWith(".md"),
    (path) => path === "docs/archive",
  );
  assert(files.length > 0);
  const link = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const root = new URL("./", ROOT).pathname;
  const broken: string[] = [];
  for (const file of files) {
    const text = await Deno.readTextFile(new URL(file, ROOT));
    for (const match of text.matchAll(link)) {
      const target = match[1]!.split("#")[0]!;
      if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = new URL(decodeURI(target), new URL(file, ROOT));
      if (!resolved.pathname.startsWith(root)) continue;
      try {
        await Deno.stat(resolved);
      } catch {
        broken.push(`${file} -> ${target}`);
      }
    }
  }
  assert(broken.length === 0, `Broken links:\n${broken.join("\n")}`);
});

/**
 * Repository paths that the source file map of docs/api.md names, and the
 * directory entries with no listed children. A directory entry without
 * children, such as `families/`, covers its whole subtree.
 */
function mapPaths(api: string): { named: Set<string>; leaves: string[] } {
  const block = api.split("## Source file map")[1]!.split("```")[1]!;
  const named = new Set<string>();
  const dirs = new Map<string, boolean>();
  const stack: { indent: number; name: string; path: string }[] = [];
  for (const line of block.split("\n")) {
    const indent = line.length - line.trimStart().length;
    const name = line.trim().split(/\s+/)[0] ?? "";
    if (name === "") continue;
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const path = (parent?.path ?? "") + name;
    named.add(path);
    if (parent !== undefined) dirs.set(parent.path, true);
    if (name.endsWith("/")) {
      dirs.set(path, dirs.get(path) ?? false);
      stack.push({ indent, name, path });
    }
  }
  const leaves = [...dirs].filter(([, hasChild]) => !hasChild).map(([path]) =>
    path
  );
  return { named, leaves };
}

Deno.test("the source file map in docs/api.md names every source file", async () => {
  const api = await Deno.readTextFile(new URL("docs/api.md", ROOT));
  const { named, leaves } = mapPaths(api);
  const sources: string[] = [];
  for (const dir of ["src", "bench", "scripts", "playground"]) {
    sources.push(
      ...await walk(
        dir,
        (path) => path.endsWith(".ts"),
        (path) => path === "playground/dist",
      ),
    );
  }
  assert(sources.length > 0);
  const missing = sources.filter((path) =>
    !named.has(path) && !leaves.some((leaf) => path.startsWith(leaf))
  ).sort();
  assert(missing.length === 0, `Not in the file map:\n${missing.join("\n")}`);
});

Deno.test("each test that the layering table of docs/architecture.md cites exists in the named file", async () => {
  const architecture = await Deno.readTextFile(
    new URL("docs/architecture.md", ROOT),
  );
  const section = architecture.split("## Layering rules")[1]!.split(
    "\n## ",
  )[0]!;
  const cited = [...section.matchAll(/`(tests\/[\w.-]+\.ts)`, "([^"]+)"/g)]
    .map((match) => ({ file: match[1]!, name: match[2]! }));
  assertEquals(cited.length, 6);
  for (const { file, name } of cited) {
    const text = await Deno.readTextFile(new URL(file, ROOT));
    assert(
      text.includes(`Deno.test("${name}"`),
      `${file} has no test named "${name}"`,
    );
  }
});

Deno.test("the newest versioned heading of CHANGELOG.md equals the version in deno.json", async () => {
  const changelog = await Deno.readTextFile(new URL("CHANGELOG.md", ROOT));
  const config: unknown = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", ROOT)),
  );
  const version = typeof config === "object" && config !== null &&
      "version" in config && typeof config.version === "string"
    ? config.version
    : undefined;
  assert(version !== undefined, "deno.json has no string version");
  const heading = /^## (\d+\.\d+\.\d+) - /m.exec(changelog);
  assert(heading !== null, "CHANGELOG.md has no versioned heading");
  assertEquals(heading[1], version);
});
