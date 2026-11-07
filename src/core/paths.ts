// Paths and generated-file identity: root-relative paths, module names, the
// generated file of a source file, and the header line that marks a file as
// generated. This file imports only the `FileMode` type.

import type { FileMode } from "./syntax.ts";

/** Joins a root and a root-relative path. An empty root or "." gives the path itself. */
export function joinPath(root: string, relative: string): string {
  if (root === "" || root === ".") return relative;
  return `${root.replace(/\/+$/, "")}/${relative}`;
}

/**
 * Normalizes a relative path with POSIX separators. Removes `.` segments and
 * resolves `..` segments. Returns undefined when the path is absolute, empty, or
 * leaves the root.
 */
export function normalizeRelative(path: string): string | undefined {
  if (path.startsWith("/") || path.includes("\\")) return undefined;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length === 0 ? undefined : parts.join("/");
}

const SOURCE_EXTENSION = ".eff";
const INTERFACE_EXTENSION = ".effi";

export function isSourcePath(path: string): boolean {
  return path.endsWith(SOURCE_EXTENSION);
}

export function isInterfacePath(path: string): boolean {
  return path.endsWith(INTERFACE_EXTENSION);
}

export function isModulePath(path: string): boolean {
  return isSourcePath(path) || isInterfacePath(path);
}

/** `.effi` files are host interface files. Every other path parses as `.eff`. */
export function fileModeOf(path: string): FileMode {
  return isInterfacePath(path) ? "effi" : "eff";
}

/** The module name of a file: its root-relative path without `.eff` or `.effi`. */
export function moduleNameOf(path: string): string {
  if (isInterfacePath(path)) {
    return path.slice(0, -INTERFACE_EXTENSION.length);
  }
  if (isSourcePath(path)) return path.slice(0, -SOURCE_EXTENSION.length);
  return path;
}

/** The generated file of a source path: `x.eff` gives `x.ts`, `x.effi` gives `x.effi.ts`. */
export function generatedPathOf(path: string): string {
  return isInterfacePath(path) ? `${path}.ts` : `${moduleNameOf(path)}.ts`;
}

/** The source map of a generated file: `x.ts` gives `x.ts.map`. */
export function sourceMapPathOf(generatedPath: string): string {
  return `${generatedPath}.map`;
}

/** The `.eff` and `.effi` paths of a module name, in that order. */
export function modulePathsOf(module: string): [string, string] {
  return [`${module}${SOURCE_EXTENSION}`, `${module}${INTERFACE_EXTENSION}`];
}

/** The last segment of a path. */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The module name that the prelude import uses. */
export const PRELUDE_MODULE = "effektive:prelude";

export function isPreludeModule(module: string): boolean {
  return module === PRELUDE_MODULE;
}

const HOST_PREFIX = "host:";

/** True for a host label such as `host:providers`. */
export function isHostLabel(label: string): boolean {
  return label.startsWith(HOST_PREFIX);
}

/** The registry key of a host label: `providers` for `host:providers`. */
export function hostKeyOf(label: string): string {
  return label.slice(HOST_PREFIX.length);
}

function directoryOf(path: string): string[] {
  const parts = path.split("/");
  parts.pop();
  return parts;
}

/** The import specifier from one root-relative file to another. */
export function relativeSpecifier(fromFile: string, toFile: string): string {
  const from = directoryOf(fromFile);
  const to = toFile.split("/");
  let common = 0;
  while (
    common < from.length && common < to.length - 1 &&
    from[common] === to[common]
  ) {
    common += 1;
  }
  const ups = from.length - common;
  const rest = to.slice(common).join("/");
  return ups === 0 ? `./${rest}` : `${"../".repeat(ups)}${rest}`;
}

/** The first line of a generated file. Only the emitter and `generatedSourceOf` may write or read it. */
export function generatedHeader(source: string): string {
  return `// Generated from ${source} by the Effektive compiler. Do not edit.`;
}

const HEADER_PATTERN =
  /^\/\/ Generated from (.+\.effi?) by the Effektive compiler\. Do not edit\.$/;

/**
 * The source that the first line of `text` names, when that line is exactly a
 * generated header. One trailing `\r` is ignored. Otherwise undefined.
 */
export function generatedSourceOf(text: string): string | undefined {
  const line = text.split("\n", 1)[0].replace(/\r$/, "");
  return HEADER_PATTERN.exec(line)?.[1];
}
