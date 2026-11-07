// The files of a project directory. The CLI reads every `.eff` and `.effi` file
// under the root, and `effektive.json` at the root. The walk skips directories
// whose names start with `.` and directories named `node_modules`.

import {
  compareText,
  CONFIG_FILE,
  generatedSourceOf,
  isModulePath,
  joinPath,
  type Result,
} from "../core/mod.ts";
import type { HostFs } from "./io.ts";
import type { FileFailure } from "./ports.ts";

function skippedDirectory(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

/** True for a root-relative path that the program reads: a source file or the project file. */
export function isWorkspaceInput(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  const directories = parts.slice(0, -1);
  if (directories.some(skippedDirectory)) return false;
  return isModulePath(name) ||
    (directories.length === 0 && name === CONFIG_FILE);
}

/** The absolute form of an existing path, or undefined when it cannot be resolved. */
export function realPath(fs: HostFs, path: string): string | undefined {
  try {
    return fs.absolute(path);
  } catch {
    return undefined;
  }
}

function insideRoot(root: string, path: string): boolean {
  const separator = root.includes("\\") && !root.startsWith("/") ? "\\" : "/";
  const prefix = root.endsWith(separator) ? root : `${root}${separator}`;
  return path === root || path.startsWith(prefix);
}

/**
 * Joins a project path after every existing component stays inside the
 * resolved root. A dangling symbolic link fails closed.
 */
export function containedProjectPath(
  fs: HostFs,
  root: string,
  relative: string,
): Result<string, FileFailure> {
  const parts = relative.split("/");
  if (
    relative.includes("\\") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    return {
      ok: false,
      error: { message: "path is not relative to the project root" },
    };
  }
  const resolvedRoot = realPath(fs, root);
  if (resolvedRoot === undefined) {
    return { ok: false, error: { message: "project root cannot be resolved" } };
  }
  let path = root;
  for (const part of parts) {
    path = joinPath(path, part);
    const entry = fs.entryKind(path);
    if (!entry.ok) return entry;
    if (entry.value === "missing") break;
    const resolved = realPath(fs, path);
    if (resolved === undefined) {
      return {
        ok: false,
        error: {
          message: entry.value === "symlink"
            ? "symbolic link target cannot be resolved"
            : "path cannot be resolved",
        },
      };
    }
    if (!insideRoot(resolvedRoot, resolved)) {
      return {
        ok: false,
        error: { message: "path resolves outside the project root" },
      };
    }
  }
  return { ok: true, value: joinPath(root, relative) };
}

/**
 * Reads the files of the project. The result maps each root-relative path to
 * its text. A file that disappears between the listing and the read is skipped.
 * A file that cannot be read gives an error value.
 */
export function readWorkspace(
  fs: HostFs,
  root: string,
  accepts: (path: string) => boolean = isWorkspaceInput,
): Result<ReadonlyMap<string, string>, string> {
  const files = new Map<string, string>();
  let failure: string | undefined;
  const realRoot = realPath(fs, root);
  if (realRoot === undefined) {
    return { ok: false, error: `${root}: cannot be resolved` };
  }
  const visited = new Set<string>();
  const visit = (relative: string): void => {
    if (failure !== undefined) return;
    const path = relative === "" ? root : joinPath(root, relative);
    // Every directory goes through this check, because a listing does not say
    // which entry is a link.
    const real = relative === "" ? realRoot : realPath(fs, path);
    if (real === undefined) {
      failure = `${relative}: cannot be resolved`;
      return;
    }
    if (visited.has(real)) return;
    if (relative !== "" && !insideRoot(realRoot, real)) return;
    visited.add(real);
    const listed = fs.list(path);
    if (!listed.ok) {
      failure = listed.error.message;
      return;
    }
    const entries = [...listed.value].sort((a, b) =>
      compareText(a.name, b.name)
    );
    for (const entry of entries) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory) {
        if (!skippedDirectory(entry.name)) visit(child);
      } else if (accepts(child)) {
        const contained = containedProjectPath(fs, root, child);
        if (!contained.ok) {
          failure = `${child} cannot be read: ${contained.error.message}`;
          return;
        }
        const read = fs.readText(contained.value);
        if (read.ok) files.set(child, read.value);
        else if (read.error.tag === "unreadable") {
          failure = `${child} cannot be read: ${read.error.message}`;
          return;
        }
      }
    }
  };
  visit("");
  return failure === undefined
    ? { ok: true, value: files }
    : { ok: false, error: failure };
}

/** Local target-check inputs; generated modules are filtered after reading. */
export function isTargetPath(path: string): boolean {
  const parts = path.split("/");
  if (parts.slice(0, -1).some(skippedDirectory)) return false;
  return /\.(?:[cm]?[jt]sx?|jsonc?)$/.test(path) ||
    /(?:^|\/)(?:deno\.jsonc?|deno\.lock|tsconfig(?:\.[^/]+)?\.json|import[-_]map\.json|package(?:-lock)?\.json)$/
      .test(path);
}

export function readTargetInputs(
  fs: HostFs,
  root: string,
): Result<ReadonlyMap<string, string>, string> {
  const read = readWorkspace(fs, root, isTargetPath);
  if (!read.ok) return read;
  return {
    ok: true,
    value: new Map(
      [...read.value].filter(([, text]) =>
        generatedSourceOf(text) === undefined
      ),
    ),
  };
}
