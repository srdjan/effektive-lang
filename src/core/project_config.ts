import { emptyMap } from "./runtime.ts";
// The project configuration: the `effektive.json` reader, its validation, and the glob
// patterns of the import rules. The module loader in `project.ts` uses it.
import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import {
  hostKeyOf,
  isHostLabel,
  isInterfacePath,
  isModulePath,
  joinPath,
  type ModuleName,
  normalizeRelative,
  type PathText,
} from "./paths.ts";
import {
  parseJson,
  type Result,
  type SourceHost,
  type SourceText,
  type Span,
} from "./source.ts";
import { errorMessage, isRecord, type Text } from "./util.ts";
export const CONFIG_FILE = "effektive.json";
type HostModuleConfig = {
  /** Root-relative path of the `.effi` interface file. */
  readonly interfacePath: string;
  /** Root-relative path of the TypeScript module that implements the interface. */
  readonly modulePath: string;
};
type ImportRuleConfig = {
  /** Glob over root-relative module names, without `.eff` or `.effi`. */
  readonly from: string;
  /** Module-name globs or `host:` specifier patterns. */
  readonly allow: readonly string[];
};
export type ProjectConfig = {
  /** Host modules by registry key. The import `host:providers` selects the key `providers`. */
  readonly host: ReadonlyMap<string, HostModuleConfig>;
  /** The first matching rule controls a module. No rules leave imports unrestricted. */
  readonly imports?: readonly ImportRuleConfig[];
};
/** The cache key of a configuration. It lists every field, so a new field must be added here. */
type ConfigKey = string;
type ImportPermission = boolean;
type ImportTarget = string;
export function configKey(config: ProjectConfig): ConfigKey {
  return JSON.stringify([
    [...config.host].map((
      entry,
    ) => [entry[0], entry[1].interfacePath, entry[1].modulePath]),
    config.imports?.map((rule) => [rule.from, ...rule.allow]) ?? null,
  ]);
}
export type ConfigError = {
  readonly tag: "missing";
  readonly path: string;
} | {
  readonly tag: "unreadable";
  readonly path: string;
  readonly message: string;
} | {
  readonly tag: "malformed-json";
  readonly path: string;
  readonly message: string;
} | {
  readonly tag: "invalid-shape";
  readonly path: string;
  readonly message: string;
};
export function describeConfigError(error: ConfigError): Text {
  {
    const kind_1 = error.tag;
    if (kind_1 === "missing") {
      return `${error.path} does not exist`;
    } else if (kind_1 === "unreadable") {
      return `${error.path} cannot be read: ${error.message}`;
    } else if (kind_1 === "malformed-json") {
      return `${error.path} is not valid JSON: ${error.message}`;
    } else if (kind_1 === "invalid-shape") {
      return `${error.path} is not a valid project file: ${error.message}`;
    }
    const unreachable: never = error;
    return unreachable;
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
const TOP_KEYS: readonly string[] = ["host", "imports"];
const HOST_KEYS: readonly string[] = ["interface", "module"];
const IMPORT_RULE_KEYS: readonly string[] = ["from", "allow"];
const MODULE_SEGMENT_CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-";
function validModuleSegment(part: string): boolean {
  for (const character of part) {
    if (!MODULE_SEGMENT_CHARACTERS.includes(character)) {
      return false;
    }
  }
  return part.length > 0;
}
function validModulePattern(pattern: string): boolean {
  if (pattern === "" || pattern.startsWith("/") || pattern.includes("\\")) {
    return false;
  }
  const parts = pattern.split("/");
  if (
    parts.some((part) =>
      part === "" || part === "." || part === ".." ||
      (part.includes("*") && part !== "*" && part !== "**") ||
      (part !== "*" && part !== "**" && !validModuleSegment(part))
    )
  ) {
    return false;
  }
  const last = parts[parts.length - 1];
  return !isModulePath(last);
}
function validTargetPattern(pattern: string): boolean {
  if (!isHostLabel(pattern)) {
    return validModulePattern(pattern);
  }
  const key = hostKeyOf(pattern);
  return key !== "" && (key === "*" || !key.includes("*"));
}
function modulePatternMatches(pattern: string, module: string): boolean {
  const patterns = pattern.split("/");
  const parts = module.split("/");
  let memo = emptyMap<string, boolean>();
  function matches(patternIndex: number, partIndex: number): boolean {
    const key = `${patternIndex}:${partIndex}`;
    const known = memo.get(key);
    if (known !== undefined) {
      return known;
    }
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
    memo = memo.set(key, result);
    return result;
  }
  return matches(0, 0);
}
export function importAllowed(
  config: ProjectConfig,
  source: ModuleName,
  target: ImportTarget,
): ImportPermission {
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
type ConfigResult = {
  readonly config: ProjectConfig;
  readonly diagnostics: readonly Diagnostic[];
};
/** Parses the text of `effektive.json`. Unknown keys give diagnostics. */
export function parseConfig(
  text: SourceText,
): Result<ConfigResult, ConfigError> {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        tag: "malformed-json",
        path: CONFIG_FILE,
        message: errorMessage(parsed.error),
      },
    };
  }
  const data = parsed.value;
  function invalid(message: string): Result<ConfigResult, ConfigError> {
    return {
      ok: false,
      error: { tag: "invalid-shape", path: CONFIG_FILE, message: message },
    };
  }
  if (!isRecord(data)) {
    return invalid("the top level must be an object");
  }
  const diagnostics: Diagnostic[] = [];
  for (const key of Object.keys(data)) {
    if (!TOP_KEYS.includes(key)) {
      {
        const _appendTarget1 = diagnostics;
        const _appendValue2 = makeDiagnostic(
          "module/001",
          `unknown key \`${key}\` in ${CONFIG_FILE}`,
          keySpan(text, key, 0),
        );
        _appendTarget1[_appendTarget1.length] = _appendValue2;
      }
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
    for (const indexed of importsData.entries()) {
      const i = indexed[0];
      const entry = indexed[1];
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
        if (!IMPORT_RULE_KEYS.includes(field)) {
          {
            const _appendTarget3 = diagnostics;
            const _appendValue4 = makeDiagnostic(
              "module/001",
              `unknown key \`${field}\` in imports entry ${i + 1}`,
              keySpan(text, field, entryStart),
            );
            _appendTarget3[_appendTarget3.length] = _appendValue4;
          }
        }
      }
      ruleStart = entryStart + 1;
      {
        const _appendTarget5 = rules;
        const _appendValue6 = { from: from, allow: allow };
        _appendTarget5[_appendTarget5.length] = _appendValue6;
      }
    }
    imports = rules;
  }
  const hostData = data["host"];
  let host = emptyMap<string, HostModuleConfig>();
  if (hostData !== undefined) {
    if (!isRecord(hostData)) {
      return invalid("`host` must be an object");
    }
    const hostStart = keySpan(text, "host", 0).start;
    for (const key of Object.keys(hostData)) {
      const entry = hostData[key];
      if (!isRecord(entry)) {
        return invalid(`host entry \`${key}\` must be an object`);
      }
      const entryStart = keySpan(text, key, hostStart).start;
      for (const field of Object.keys(entry)) {
        if (!HOST_KEYS.includes(field)) {
          {
            const _appendTarget7 = diagnostics;
            const _appendValue8 = makeDiagnostic(
              "module/001",
              `unknown key \`${field}\` in host entry \`${key}\``,
              keySpan(text, field, entryStart),
            );
            _appendTarget7[_appendTarget7.length] = _appendValue8;
          }
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
        {
          const _appendTarget9 = diagnostics;
          const _appendValue10 = makeDiagnostic(
            "module/001",
            `the interface of host entry \`${key}\` must be a path inside the project root that ends in .effi`,
            interfaceSpan,
          );
          _appendTarget9[_appendTarget9.length] = _appendValue10;
        }
        continue;
      }
      if (modulePath === undefined) {
        {
          const _appendTarget11 = diagnostics;
          const _appendValue12 = makeDiagnostic(
            "module/001",
            `the module of host entry \`${key}\` must be a path inside the project root`,
            keySpan(text, "module", entryStart),
          );
          _appendTarget11[_appendTarget11.length] = _appendValue12;
        }
        continue;
      }
      host = host.set(key, {
        interfacePath: interfacePath,
        modulePath: modulePath,
      });
    }
  }
  const config: ProjectConfig = imports === undefined
    ? { host: host }
    : { host: host, imports: imports };
  return { ok: true, value: { config: config, diagnostics: diagnostics } };
}
/** Reads and parses `effektive.json` in the project root. */
export function readConfig(
  host: SourceHost,
  root: PathText,
): Result<ConfigResult, ConfigError> {
  const path = joinPath(root, CONFIG_FILE);
  const read = host.readText(path);
  if (!read.ok) {
    return {
      ok: false,
      error: read.error.tag === "not-found"
        ? { tag: "missing", path: path }
        : { tag: "unreadable", path: path, message: read.error.message },
    };
  }
  return parseConfig(read.value);
}
