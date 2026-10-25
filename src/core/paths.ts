// Paths and generated-file identity: root-relative paths, module names, the
// generated file of a source file, and the header line that marks a file as
// generated. This file imports no other core module.

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

/** The module name of a file: its root-relative path without `.eff` or `.effi`. */
export function moduleNameOf(path: string): string {
  if (path.endsWith(".effi")) return path.slice(0, -5);
  if (path.endsWith(".eff")) return path.slice(0, -4);
  return path;
}

/** The generated file of a source path: `x.eff` gives `x.ts`, `x.effi` gives `x.effi.ts`. */
export function generatedPathOf(path: string): string {
  return path.endsWith(".effi") ? `${path}.ts` : `${moduleNameOf(path)}.ts`;
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
