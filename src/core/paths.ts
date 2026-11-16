// Paths and generated-file identity: root-relative paths, module names, the
// generated file of a source file, and the header line that marks a file as
// generated. This file imports only the `FileMode` type.

import type { FileMode } from "./syntax.ts";

export type PathText = string;
export type OptionalPath = PathText | undefined;
export type PathMatch = boolean;
export type ModuleName = string;
export type HostLabel = string;
export type HostKey = string;
export type SourceText = string;

/** Joins a root and a root-relative path. An empty root or "." gives the path itself. */
export function joinPath(root: PathText, relative: PathText): PathText {
  if (root === "" || root === ".") return relative;
  const end = root.split("").findLastIndex((character) => character !== "/");
  return `${root.slice(0, end + 1)}/${relative}`;
}

/**
 * Normalizes a relative path with POSIX separators. Removes `.` segments and
 * resolves `..` segments. Returns undefined when the path is absolute, empty, or
 * leaves the root.
 */
export function normalizeRelative(path: PathText): OptionalPath {
  if (path.startsWith("/") || path.includes("\\")) return undefined;
  const parts = path.split("/").reduce<readonly string[] | undefined>(
    (accepted, part) => {
      if (accepted === undefined) return undefined;
      if (part === "" || part === ".") return accepted;
      if (part === "..") {
        return accepted.length === 0 ? undefined : accepted.slice(0, -1);
      }
      return [...accepted, part];
    },
    [],
  );
  if (parts === undefined) return undefined;
  return parts.length === 0 ? undefined : parts.join("/");
}

const SOURCE_EXTENSION = ".eff";
const INTERFACE_EXTENSION = ".effi";

export function isSourcePath(path: PathText): PathMatch {
  return path.endsWith(SOURCE_EXTENSION);
}

export function isInterfacePath(path: PathText): PathMatch {
  return path.endsWith(INTERFACE_EXTENSION);
}

export function isModulePath(path: PathText): PathMatch {
  return isSourcePath(path) || isInterfacePath(path);
}

/** `.effi` files are host interface files. Every other path parses as `.eff`. */
export function fileModeOf(path: PathText): FileMode {
  return isInterfacePath(path) ? "effi" : "eff";
}

/** The module name of a file: its root-relative path without `.eff` or `.effi`. */
export function moduleNameOf(path: PathText): ModuleName {
  if (isInterfacePath(path)) {
    return path.slice(0, -INTERFACE_EXTENSION.length);
  }
  if (isSourcePath(path)) return path.slice(0, -SOURCE_EXTENSION.length);
  return path;
}

/** The generated file of a source path: `x.eff` gives `x.ts`, `x.effi` gives `x.effi.ts`. */
export function generatedPathOf(path: PathText): PathText {
  return isInterfacePath(path) ? `${path}.ts` : `${moduleNameOf(path)}.ts`;
}

/** The source map of a generated file: `x.ts` gives `x.ts.map`. */
export function sourceMapPathOf(generatedPath: PathText): PathText {
  return `${generatedPath}.map`;
}

/** The `.eff` and `.effi` paths of a module name, in that order. */
export function modulePathsOf(module: ModuleName): [string, string] {
  return [`${module}${SOURCE_EXTENSION}`, `${module}${INTERFACE_EXTENSION}`];
}

/** The last segment of a path. */
export function fileNameOf(path: PathText): PathText {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The module name that the prelude import uses. */
export const PRELUDE_MODULE = "effektive:prelude";

export function isPreludeModule(module: ModuleName): PathMatch {
  return module === PRELUDE_MODULE;
}

const HOST_PREFIX = "host:";

/** True for a host label such as `host:providers`. */
export function isHostLabel(label: HostLabel): PathMatch {
  return label.startsWith(HOST_PREFIX);
}

/** The registry key of a host label: `providers` for `host:providers`. */
export function hostKeyOf(label: HostLabel): HostKey {
  return label.slice(HOST_PREFIX.length);
}

function directoryOf(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1);
}

/** The import specifier from one root-relative file to another. */
export function relativeSpecifier(
  fromFile: PathText,
  toFile: PathText,
): PathText {
  const from = directoryOf(fromFile);
  const to = toFile.split("/");
  const mismatch = from.findIndex((part, index) =>
    index >= to.length - 1 || part !== to[index]
  );
  const common = mismatch < 0 ? from.length : mismatch;
  const ups = from.length - common;
  const rest = to.slice(common).join("/");
  return ups === 0 ? `./${rest}` : `${"../".repeat(ups)}${rest}`;
}

/** The first line of a generated file. Only the emitter and `generatedSourceOf` may write or read it. */
export function generatedHeader(source: PathText): SourceText {
  return `// Generated from ${source} by the Effektive compiler. Do not edit.`;
}

const HEADER_PREFIX = "// Generated from ";
const HEADER_SUFFIX = " by the Effektive compiler. Do not edit.";
/** The line terminators that a header source cannot hold, apart from `\n`. */
const LINE_TERMINATORS: readonly string[] = ["\r", "\u2028", "\u2029"];

/**
 * The source that the first line of `text` names, when that line is exactly a
 * generated header. One trailing `\r` is ignored. Otherwise undefined.
 *
 * The source is a `.eff` or `.effi` path with a nonempty stem and no line
 * terminator. This is the language of the former pattern
 * `^// Generated from (.+\.effi?) by the Effektive compiler\. Do not edit\.$`.
 */
export function generatedSourceOf(text: SourceText): OptionalPath {
  const firstLine = text.split("\n", 1)[0];
  const line = firstLine.endsWith("\r") ? firstLine.slice(0, -1) : firstLine;
  if (!line.startsWith(HEADER_PREFIX) || !line.endsWith(HEADER_SUFFIX)) {
    return undefined;
  }
  const source = line.slice(HEADER_PREFIX.length, -HEADER_SUFFIX.length);
  const extension = isInterfacePath(source)
    ? INTERFACE_EXTENSION
    : SOURCE_EXTENSION;
  const hasStem = isModulePath(source) && source.length > extension.length;
  return hasStem && !LINE_TERMINATORS.some((t) => source.includes(t))
    ? source
    : undefined;
}
