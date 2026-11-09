// The project configuration: the `effektive.json` reader, its validation, and the glob
// patterns of the import rules. The module loader in `project.ts` uses it.

import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import {
  hostKeyOf,
  isHostLabel,
  isInterfacePath,
  isModulePath,
  joinPath,
  normalizeRelative,
} from "./paths.ts";
import type { Result, SourceHost, Span } from "./source.ts";
import { errorMessage, isRecord } from "./util.ts";

export const CONFIG_FILE = "effektive.json";

interface HostModuleConfig {
  /** Root-relative path of the `.effi` interface file. */
  readonly interfacePath: string;
  /** Root-relative path of the TypeScript module that implements the interface. */
  readonly modulePath: string;
}

interface ImportRuleConfig {
  /** Glob over root-relative module names, without `.eff` or `.effi`. */
  readonly from: string;
  /** Module-name globs or `host:` specifier patterns. */
  readonly allow: readonly string[];
}

export interface ProjectConfig {
  /** Host modules by registry key. The import `host:providers` selects the key `providers`. */
  readonly host: ReadonlyMap<string, HostModuleConfig>;
  /** The first matching rule controls a module. No rules leave imports unrestricted. */
  readonly imports?: readonly ImportRuleConfig[];
}

/** The cache key of a configuration. It lists every field, so a new field must be added here. */
export function configKey(config: ProjectConfig): string {
  return JSON.stringify([
    [...config.host].map((
      [key, host],
    ) => [key, host.interfacePath, host.modulePath]),
    config.imports?.map((rule) => [rule.from, ...rule.allow]) ?? null,
  ]);
}

export type ConfigError =
  | { readonly tag: "missing"; readonly path: string }
  | {
    readonly tag: "unreadable";
    readonly path: string;
    readonly message: string;
  }
  | {
    readonly tag: "malformed-json";
    readonly path: string;
    readonly message: string;
  }
  | {
    readonly tag: "invalid-shape";
    readonly path: string;
    readonly message: string;
  };

export function describeConfigError(error: ConfigError): string {
  switch (error.tag) {
    case "missing":
      return `${error.path} does not exist`;
    case "unreadable":
      return `${error.path} cannot be read: ${error.message}`;
    case "malformed-json":
      return `${error.path} is not valid JSON: ${error.message}`;
    case "invalid-shape":
      return `${error.path} is not a valid project file: ${error.message}`;
  }
}

/** The span of the quoted key `"name"` at or after `from`, or an empty span at 0. */
function keySpan(text: string, name: string, from: number): Span {
  const quoted = JSON.stringify(name);
  const at = text.indexOf(quoted, from);
  return at < 0
    ? { source: CONFIG_FILE, start: 0, end: 0 }
    : { source: CONFIG_FILE, start: at, end: at + quoted.length };
}

const TOP_KEYS: ReadonlySet<string> = new Set(["host", "imports"]);
const HOST_KEYS: ReadonlySet<string> = new Set(["interface", "module"]);
const IMPORT_RULE_KEYS: ReadonlySet<string> = new Set(["from", "allow"]);

function validModulePattern(pattern: string): boolean {
  if (pattern === "" || pattern.startsWith("/") || pattern.includes("\\")) {
    return false;
  }
  const parts = pattern.split("/");
  if (
    parts.some((part) =>
      part === "" || part === "." || part === ".." ||
      (part.includes("*") && part !== "*" && part !== "**") ||
      (part !== "*" && part !== "**" && !/^[A-Za-z0-9_.-]+$/.test(part))
    )
  ) {
    return false;
  }
  const last = parts[parts.length - 1];
  return !isModulePath(last);
}

function validTargetPattern(pattern: string): boolean {
  if (!isHostLabel(pattern)) return validModulePattern(pattern);
  const key = hostKeyOf(pattern);
  return key !== "" && (key === "*" || !key.includes("*"));
}

function modulePatternMatches(pattern: string, module: string): boolean {
  const patterns = pattern.split("/");
  const parts = module.split("/");
  const memo = new Map<string, boolean>();
  const matches = (patternIndex: number, partIndex: number): boolean => {
    const key = `${patternIndex}:${partIndex}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (patternIndex === patterns.length) {
      result = partIndex === parts.length;
    } else if (patterns[patternIndex] === "**") {
      result = matches(patternIndex + 1, partIndex) ||
        (partIndex < parts.length && matches(patternIndex, partIndex + 1));
    } else {
      result = partIndex < parts.length &&
        (patterns[patternIndex] === "*" ||
          patterns[patternIndex] === parts[partIndex]) &&
        matches(patternIndex + 1, partIndex + 1);
    }
    memo.set(key, result);
    return result;
  };
  return matches(0, 0);
}

export function importAllowed(
  config: ProjectConfig,
  source: string,
  target: string,
): boolean {
  const rule = config.imports?.find((candidate) =>
    modulePatternMatches(candidate.from, source)
  );
  return rule === undefined ||
    rule.allow.some((pattern) =>
      isHostLabel(target)
        ? pattern === "host:*" || pattern === target
        : !isHostLabel(pattern) && modulePatternMatches(pattern, target)
    );
}

interface ConfigResult {
  readonly config: ProjectConfig;
  readonly diagnostics: readonly Diagnostic[];
}

/** Parses the text of `effektive.json`. Unknown keys give diagnostics. */
export function parseConfig(
  text: string,
): Result<ConfigResult, ConfigError> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: {
        tag: "malformed-json",
        path: CONFIG_FILE,
        message: errorMessage(e),
      },
    };
  }
  const invalid = (message: string): Result<ConfigResult, ConfigError> => ({
    ok: false,
    error: { tag: "invalid-shape", path: CONFIG_FILE, message },
  });
  if (!isRecord(data)) return invalid("the top level must be an object");
  const diagnostics: Diagnostic[] = [];
  for (const key of Object.keys(data)) {
    if (!TOP_KEYS.has(key)) {
      diagnostics.push(makeDiagnostic(
        "module/001",
        `unknown key \`${key}\` in ${CONFIG_FILE}`,
        keySpan(text, key, 0),
      ));
    }
  }
  const importsData = data["imports"];
  let imports: readonly ImportRuleConfig[] | undefined;
  if (importsData !== undefined) {
    if (!Array.isArray(importsData)) {
      return invalid("`imports` must be an array");
    }
    const rules: ImportRuleConfig[] = [];
    let ruleStart = keySpan(text, "imports", 0).start;
    for (let i = 0; i < importsData.length; i++) {
      const entry = importsData[i];
      if (!isRecord(entry)) {
        return invalid(`imports entry ${i + 1} must be an object`);
      }
      const from = entry["from"];
      const allow = entry["allow"];
      if (typeof from !== "string") {
        return invalid(`imports entry ${i + 1} needs a string \`from\``);
      }
      if (!validModulePattern(from)) {
        return invalid(
          `imports entry ${i + 1} has an invalid \`from\` pattern \`${from}\``,
        );
      }
      if (
        !Array.isArray(allow) ||
        !allow.every((value) => typeof value === "string")
      ) {
        return invalid(`imports entry ${i + 1} needs a string array \`allow\``);
      }
      for (const pattern of allow) {
        if (!validTargetPattern(pattern)) {
          return invalid(
            `imports entry ${
              i + 1
            } has an invalid \`allow\` pattern \`${pattern}\``,
          );
        }
      }
      const entryStart = keySpan(text, "from", ruleStart).start;
      for (const field of Object.keys(entry)) {
        if (!IMPORT_RULE_KEYS.has(field)) {
          diagnostics.push(makeDiagnostic(
            "module/001",
            `unknown key \`${field}\` in imports entry ${i + 1}`,
            keySpan(text, field, entryStart),
          ));
        }
      }
      ruleStart = entryStart + 1;
      rules.push({ from, allow });
    }
    imports = rules;
  }
  const hostData = data["host"];
  const host = new Map<string, HostModuleConfig>();
  if (hostData !== undefined) {
    if (!isRecord(hostData)) return invalid("`host` must be an object");
    const hostStart = keySpan(text, "host", 0).start;
    for (const key of Object.keys(hostData)) {
      const entry = hostData[key];
      if (!isRecord(entry)) {
        return invalid(`host entry \`${key}\` must be an object`);
      }
      const entryStart = keySpan(text, key, hostStart).start;
      for (const field of Object.keys(entry)) {
        if (!HOST_KEYS.has(field)) {
          diagnostics.push(makeDiagnostic(
            "module/001",
            `unknown key \`${field}\` in host entry \`${key}\``,
            keySpan(text, field, entryStart),
          ));
        }
      }
      const interfaceValue = entry["interface"];
      const moduleValue = entry["module"];
      if (typeof interfaceValue !== "string") {
        return invalid(`host entry \`${key}\` needs a string \`interface\``);
      }
      if (typeof moduleValue !== "string") {
        return invalid(`host entry \`${key}\` needs a string \`module\``);
      }
      const interfacePath = normalizeRelative(interfaceValue);
      const modulePath = normalizeRelative(moduleValue);
      const interfaceSpan = keySpan(text, "interface", entryStart);
      if (interfacePath === undefined || !isInterfacePath(interfacePath)) {
        diagnostics.push(makeDiagnostic(
          "module/001",
          `the interface of host entry \`${key}\` must be a path inside the project root that ends in .effi`,
          interfaceSpan,
        ));
        continue;
      }
      if (modulePath === undefined) {
        diagnostics.push(makeDiagnostic(
          "module/001",
          `the module of host entry \`${key}\` must be a path inside the project root`,
          keySpan(text, "module", entryStart),
        ));
        continue;
      }
      host.set(key, { interfacePath, modulePath });
    }
  }
  const config: ProjectConfig = imports === undefined
    ? { host }
    : { host, imports };
  return { ok: true, value: { config, diagnostics } };
}

/** Reads and parses `effektive.json` in the project root. */
export function readConfig(
  host: SourceHost,
  root: string,
): Result<ConfigResult, ConfigError> {
  const path = joinPath(root, CONFIG_FILE);
  const read = host.readText(path);
  if (!read.ok) {
    return {
      ok: false,
      error: read.error.tag === "not-found"
        ? { tag: "missing", path }
        : { tag: "unreadable", path, message: read.error.message },
    };
  }
  return parseConfig(read.value);
}
