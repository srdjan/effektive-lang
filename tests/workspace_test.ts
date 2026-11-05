import { assertEquals } from "@std/assert";
import type { ReadError, Result } from "../src/core/frontend.ts";
import type { DirectoryEntry, FileFailure, HostFs } from "../src/host/io.ts";
import {
  isTargetPath,
  readTargetInputs,
  readWorkspace,
} from "../src/host/workspace.ts";
import { memoryIo } from "./cli_helpers.ts";

/**
 * A file system with directory links. `files` maps real file paths to texts.
 * `links` maps the path of a link to its target. A link resolves in any
 * position of a path, so `absolute` gives the real path of a directory.
 */
function linkedFs(
  files: Readonly<Record<string, string>>,
  links: Readonly<Record<string, string>>,
): HostFs {
  const resolve = (path: string): string => {
    let current = path;
    for (let hop = 0; hop < 64; hop++) {
      const parts = current.split("/");
      let changed = false;
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join("/");
        const target = links[prefix];
        if (target !== undefined) {
          current = [target, ...parts.slice(i)].join("/");
          changed = true;
          break;
        }
      }
      if (!changed) return current;
    }
    throw new Error(`too many links: ${path}`);
  };
  return {
    readText(path: string): Result<string, ReadError> {
      const text = files[resolve(path)];
      return text === undefined
        ? { ok: false, error: { tag: "not-found", path } }
        : { ok: true, value: text };
    },
    writeText: () => ({ ok: false, error: { message: "read only" } }),
    remove: () => ({ ok: false, error: { message: "read only" } }),
    entryKind: (path) => ({
      ok: true,
      value: links[path] !== undefined
        ? "symlink"
        : files[path] !== undefined ||
            Object.keys(files).some((key) => key.startsWith(`${path}/`))
        ? "other"
        : "missing",
    }),
    kind: (path) => {
      const real = resolve(path);
      if (files[real] !== undefined) return "file";
      return Object.keys(files).some((key) => key.startsWith(`${real}/`))
        ? "directory"
        : "missing";
    },
    list(path: string): Result<readonly DirectoryEntry[], FileFailure> {
      const real = resolve(path);
      const found = new Map<string, boolean>();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(`${real}/`)) continue;
        const rest = key.slice(real.length + 1);
        const slash = rest.indexOf("/");
        if (slash < 0) found.set(rest, false);
        else found.set(rest.slice(0, slash), true);
      }
      for (const link of Object.keys(links)) {
        const slash = link.lastIndexOf("/");
        if (resolve(link.slice(0, slash)) === real) {
          let isDirectory = false;
          try {
            const target = resolve(link);
            isDirectory = Object.keys(files).some((key) =>
              key.startsWith(`${target}/`)
            );
          } catch {
            // An unresolved cycle is not a directory in the real listing.
          }
          found.set(link.slice(slash + 1), isDirectory);
        }
      }
      return {
        ok: true,
        value: [...found].map(([name, isDirectory]) => ({ name, isDirectory })),
      };
    },
    absolute: resolve,
  };
}

const FILES = {
  "/p/effektive.json": "{}",
  "/p/a.eff": "a",
  "/p/sub/b.eff": "b",
  "/other/c.eff": "c",
};

/** The texts that the walk reads, sorted. Each real file must appear once. */
function textsOf(links: Readonly<Record<string, string>>): string[] {
  const read = readWorkspace(linkedFs(FILES, links), "/p");
  if (!read.ok) throw new Error(read.error);
  return [...read.value.values()].sort();
}

const ONCE = ["a", "b", "{}"];

Deno.test("readWorkspace rejects a root that cannot be resolved", () => {
  const m = memoryIo({ "/p/effektive.json": "{}" });
  const result = readWorkspace({
    ...m.io.fs,
    absolute: () => {
      throw new Error("permission denied");
    },
  }, "/p");
  assertEquals(result, { ok: false, error: "/p: cannot be resolved" });
});

Deno.test("readWorkspace accepts canonical Windows and POSIX root separators", () => {
  const files = {
    "/p/effektive.json": "{}",
    "/p/main.eff": "type Int = int\n",
    "/p/sub/other.eff": "type Text = string\n",
  };
  for (
    const [canonicalRoot, separator] of [
      ["C:\\project", "\\"],
      ["C:\\", "\\"],
      ["\\\\server\\share\\project", "\\"],
      ["/project\\literal", "/"],
    ]
  ) {
    const fs = memoryIo(files).io.fs;
    const prefix = canonicalRoot.endsWith(separator)
      ? canonicalRoot.slice(0, -separator.length)
      : canonicalRoot;
    const result = readWorkspace({
      ...fs,
      absolute: (path) =>
        path === "/p"
          ? canonicalRoot
          : prefix + path.slice("/p".length).replaceAll("/", separator),
    }, "/p");
    assertEquals(result.ok && [...result.value.keys()], [
      "effektive.json",
      "main.eff",
      "sub/other.eff",
    ], canonicalRoot);
  }
});

Deno.test("readWorkspace rejects sibling paths with native or literal backslashes", () => {
  const fs = memoryIo({
    "/p/effektive.json": "{}",
    "/p/main.eff": "type Int = int\n",
  }).io.fs;
  for (
    const [root, target, separator] of [
      ["C:\\project", "C:\\project-other\\main.eff", "\\"],
      ["/project", "/project\\other/main.eff", "/"],
    ]
  ) {
    assertEquals(
      readWorkspace({
        ...fs,
        absolute: (path) =>
          path === "/p/main.eff"
            ? target
            : root + path.slice(2).replaceAll("/", separator),
      }, "/p"),
      {
        ok: false,
        error:
          "main.eff cannot be read: path resolves outside the project root",
      },
    );
  }
});

Deno.test("readWorkspace reads each file once when a link points to its own parent", () => {
  assertEquals(textsOf({ "/p/sub/up": "/p" }), ONCE);
});

Deno.test("readWorkspace ends on a cycle between two links", () => {
  assertEquals(textsOf({ "/p/sub/x": "/p/y", "/p/y": "/p/sub" }), ONCE);
});

Deno.test("readWorkspace skips a link to the parent of the root", () => {
  assertEquals(textsOf({ "/p/out": "/" }), ONCE);
});

Deno.test("readWorkspace skips a link to a directory outside the root", () => {
  assertEquals(textsOf({ "/p/elsewhere": "/other" }), ONCE);
});

Deno.test("readWorkspace reads a directory once when a link points to a directory inside the root", () => {
  assertEquals(textsOf({ "/p/alias": "/p/sub" }), ONCE);
});

Deno.test("readWorkspace rejects a required directory that cannot be resolved", () => {
  const fs = linkedFs(FILES, {});
  const read = readWorkspace(
    {
      ...fs,
      absolute: (path) => {
        if (path === "/p/sub") throw new Error("gone");
        return fs.absolute(path);
      },
    },
    "/p",
  );
  assertEquals(read, { ok: false, error: "sub: cannot be resolved" });
});

Deno.test("readWorkspace rejects a listed directory link after a transient resolution failure", () => {
  const fs = linkedFs({
    "/p/effektive.json": "{}",
    "/p/.hidden/a.eff": "a",
  }, { "/p/source": "/p/.hidden" });
  let failed = false;
  const read = readWorkspace({
    ...fs,
    absolute(path) {
      if (path === "/p/source" && !failed) {
        failed = true;
        throw new Error("permission denied");
      }
      return fs.absolute(path);
    },
  }, "/p");
  assertEquals(read, { ok: false, error: "source: cannot be resolved" });
});

Deno.test("readWorkspace identifies an unresolved source link in its read error", () => {
  const fs = memoryIo({ "/p/main.eff": "source" }).io.fs;
  const read = readWorkspace({
    ...fs,
    entryKind: (path) =>
      path === "/p/main.eff"
        ? { ok: true, value: "symlink" }
        : fs.entryKind(path),
    absolute(path) {
      if (path === "/p/main.eff") throw new Error("unresolved target");
      return fs.absolute(path);
    },
  }, "/p");
  assertEquals(read, {
    ok: false,
    error: "main.eff cannot be read: symbolic link target cannot be resolved",
  });
});

Deno.test("readWorkspace skips a listed file that disappears before its read", () => {
  const fs = linkedFs(FILES, {});
  const read = readWorkspace({
    ...fs,
    readText: (path) =>
      path === "/p/sub/b.eff"
        ? { ok: false, error: { tag: "not-found", path } }
        : fs.readText(path),
  }, "/p");
  assertEquals(read.ok && [...read.value.values()].sort(), ["a", "{}"]);
});

Deno.test("readTargetInputs leaves out the generated modules of .eff and .effi files", () => {
  const header = (source: string) =>
    `// Generated from ${source} by the Effektive compiler. Do not edit.\n`;
  const m = memoryIo({
    "/p/a.ts": `${header("a.eff")}export {};\n`,
    "/p/h.effi.ts": `${header("h.effi")}export {};\n`,
    "/p/host.ts": "export const host = 1;\n",
  });
  const result = readTargetInputs(m.io.fs, "/p");
  assertEquals(result.ok && [...result.value.keys()], ["host.ts"]);
});

Deno.test("readTargetInputs rejects a required directory that cannot be resolved", () => {
  const m = memoryIo({ "/p/sub/host.ts": "export const host = 1;\n" });
  const result = readTargetInputs({
    ...m.io.fs,
    absolute: (path) => {
      if (path === "/p/sub") throw new Error("permission denied");
      return m.io.fs.absolute(path);
    },
  }, "/p");
  assertEquals(result, { ok: false, error: "sub: cannot be resolved" });
});

Deno.test("target watching excludes hidden and dependency directories", () => {
  assertEquals(
    ["host.ts", "sub/host.ts", ".hidden/host.ts", "node_modules/host.ts"].map(
      isTargetPath,
    ),
    [true, true, false, false],
  );
});
