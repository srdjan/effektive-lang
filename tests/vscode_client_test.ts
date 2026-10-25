import { assert, assertEquals } from "@std/assert";
import { runInNewContext } from "node:vm";
import * as path from "node:path";
import { releaseManifest, releaseVersion } from "../scripts/package.ts";
import { KEYWORDS } from "../src/core/lex.ts";
import { BUILTIN_TYPE_NAMES, PRELUDE_NAMES } from "../src/core/resolve.ts";
import {
  GENERATED_CHANGED_METHOD,
  GENERATED_SCHEME,
  GENERATED_TYPESCRIPT_METHOD,
} from "../src/lsp/methods.ts";

const CLIENT = new URL("../editors/vscode/", import.meta.url);

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(relative: string): Json {
  const parsed: unknown = JSON.parse(
    Deno.readTextFileSync(new URL(relative, CLIENT)),
  );
  assert(isRecord(parsed), `${relative} must hold a JSON object`);
  return parsed;
}

function field(value: unknown, key: string): unknown {
  assert(isRecord(value), `expected an object that holds "${key}"`);
  return value[key];
}

function list(value: unknown): readonly unknown[] {
  assert(Array.isArray(value), "expected an array");
  return value;
}

/** Collects every `match` regular expression text of a grammar, at any depth. */
function collectMatches(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectMatches);
  if (!isRecord(value)) return [];
  const own = typeof value.match === "string" ? [value.match] : [];
  return own.concat(Object.values(value).flatMap(collectMatches));
}

Deno.test("the release version comes only from deno.json", () => {
  const denoJson = Deno.readTextFileSync(
    new URL("../deno.json", import.meta.url),
  );
  const version = releaseVersion(denoJson);
  const source = Deno.readTextFileSync(new URL("package.json", CLIENT));
  const released: unknown = JSON.parse(releaseManifest(source, version));
  assertEquals(field(released, "version"), version);
  // The source manifest and its lock file hold a fixed placeholder, so no
  // second copy of the release version can drift.
  assertEquals(field(readJson("package.json"), "version"), "0.0.0");
  const lock = readJson("package-lock.json");
  assertEquals(field(lock, "version"), "0.0.0");
  assertEquals(field(field(field(lock, "packages"), ""), "version"), "0.0.0");
});

Deno.test("package.json contributes the effektive language and grammar", () => {
  const pkg = readJson("package.json");
  assertEquals(pkg.name, "effektive-vscode");
  assertEquals(pkg.main, "./extension.js");
  const contributes = field(pkg, "contributes");

  const languages = list(field(contributes, "languages"));
  assertEquals(languages.length, 1);
  assertEquals(field(languages[0], "id"), "effektive");
  assertEquals(field(languages[0], "extensions"), [".eff", ".effi"]);
  assertEquals(field(languages[0], "aliases"), ["Effektive"]);
  assertEquals(
    field(languages[0], "configuration"),
    "./language-configuration.json",
  );

  const grammars = list(field(contributes, "grammars"));
  assertEquals(grammars.length, 1);
  assertEquals(field(grammars[0], "scopeName"), "source.effektive");
  assertEquals(
    field(grammars[0], "path"),
    "./syntaxes/effektive.tmLanguage.json",
  );
  assertEquals(field(grammars[0], "language"), "effektive");
});

Deno.test("package.json contributes the command and the four settings", () => {
  const contributes = field(readJson("package.json"), "contributes");

  const commands = list(field(contributes, "commands"));
  assertEquals(commands.length, 1);
  assertEquals(
    field(commands[0], "command"),
    "effektive.showGeneratedTypeScript",
  );
  assertEquals(
    field(commands[0], "title"),
    "Effektive: Show Generated TypeScript",
  );

  const menus = field(contributes, "menus");
  for (const place of ["editor/title", "commandPalette"]) {
    const entries = list(field(menus, place));
    assertEquals(entries.length, 1);
    assertEquals(field(entries[0], "when"), "editorLangId == effektive");
  }

  const properties = field(field(contributes, "configuration"), "properties");
  assert(isRecord(properties));
  assertEquals(Object.keys(properties).sort(), [
    "effektive.debounceMs",
    "effektive.server.deno",
    "effektive.server.repository",
    "effektive.writeOnSave",
  ]);
  assertEquals(field(properties["effektive.server.deno"], "default"), "deno");
  assertEquals(
    field(properties["effektive.server.repository"], "default"),
    "",
  );
  assertEquals(field(properties["effektive.writeOnSave"], "default"), true);
  assertEquals(field(properties["effektive.debounceMs"], "default"), 0);
  assertEquals(field(properties["effektive.debounceMs"], "minimum"), 0);
});

Deno.test("package.json activates on the language and the command", () => {
  const events = list(field(readJson("package.json"), "activationEvents"));
  assert(events.includes("onLanguage:effektive"));
  assert(events.includes("onCommand:effektive.showGeneratedTypeScript"));
});

Deno.test("the grammar names the scope and every lexer keyword", () => {
  const grammar = readJson("syntaxes/effektive.tmLanguage.json");
  assertEquals(grammar.scopeName, "source.effektive");
  const words = [
    ...KEYWORDS.keys(),
    ...PRELUDE_NAMES,
    ...BUILTIN_TYPE_NAMES,
    // Contextual words of the parser.
    "type",
    "error",
    "service",
    "provider",
    "provides",
    "fails",
    "uses",
    "from",
  ];
  const matchers = collectMatches(grammar).map((match) => new RegExp(match));
  for (const token of [...words, "|>", "=>"]) {
    assert(
      matchers.some((matcher) => matcher.exec(token)?.[0] === token),
      `the grammar must match the whole token "${token}"`,
    );
  }
});

Deno.test("the grammar does not highlight nominal", () => {
  const matchers = collectMatches(
    readJson("syntaxes/effektive.tmLanguage.json"),
  )
    .map((match) => new RegExp(match));
  const found = (text: string): string | undefined =>
    matchers.map((m) => m.exec(text)?.[0]).find((hit) => hit === "nominal");
  assertEquals(found("nominal User = { id: string }"), undefined);
  assertEquals(found("const nominal = 1"), undefined);
  assertEquals(found("const f = (nominal: Int): Int => nominal"), undefined);
});

Deno.test("the grammar highlights sealed and pure only as modifiers", () => {
  const matchers = collectMatches(
    readJson("syntaxes/effektive.tmLanguage.json"),
  ).map((match) => new RegExp(match));
  const found = (text: string, word: string): string | undefined =>
    matchers.map((matcher) => matcher.exec(text)?.[0]).find((hit) =>
      hit === word
    );
  assertEquals(
    found("export sealed type User = {}", "sealed"),
    "sealed",
  );
  assertEquals(found("const sealed = 1", "sealed"), undefined);
  assertEquals(found("pure (value: Int) => Int", "pure"), "pure");
  assertEquals(found("const pure = 1", "pure"), undefined);
});

Deno.test("the builtin-types rule matches every builtin type name exactly", () => {
  const rule = field(
    field(readJson("syntaxes/effektive.tmLanguage.json"), "repository"),
    "builtin-types",
  );
  assertEquals(field(rule, "name"), "support.type.builtin.effektive");
  const match = field(rule, "match");
  assert(typeof match === "string", "the rule must hold a match expression");
  const matcher = new RegExp(match);
  for (const name of BUILTIN_TYPE_NAMES) {
    assertEquals(
      matcher.exec(name)?.[0],
      name,
      `the builtin-types rule must match the whole name "${name}"`,
    );
  }
});

Deno.test("extension.js uses the method names and scheme of the server", () => {
  const source = Deno.readTextFileSync(new URL("extension.js", CLIENT));
  for (
    const value of [
      GENERATED_TYPESCRIPT_METHOD,
      GENERATED_CHANGED_METHOD,
      GENERATED_SCHEME,
    ]
  ) {
    assert(
      source.includes(`"${value}"`),
      `extension.js must hold the string literal "${value}"`,
    );
  }
});

function activateClient(
  settings: Record<string, unknown>,
  denoVersion: string | Error,
) {
  const errors: string[] = [];
  const infos: string[] = [];
  const launches: { command: string; args: string[] }[] = [];
  const commands = new Map<string, () => Promise<void>>();
  const notifications = new Map<string, (params: unknown) => void>();
  const opened: FakeUri[] = [];
  const fired: FakeUri[] = [];
  const editor: { document?: { languageId: string; uri: FakeUri } } = {};
  class Client {
    constructor(
      _id: string,
      _name: string,
      options: { command: string; args: string[] },
    ) {
      launches.push(options);
    }
    onNotification(method: string, handler: (params: unknown) => void) {
      notifications.set(method, handler);
    }
    start() {
      return Promise.resolve();
    }
  }
  const module = { exports: {} as { activate?: (context: unknown) => void } };
  const vscode = {
    workspace: {
      getConfiguration: () => ({
        get: (name: string, fallback: unknown) => settings[name] ?? fallback,
      }),
      createFileSystemWatcher: () => ({}),
      registerTextDocumentContentProvider: () => ({}),
      openTextDocument: (uri: FakeUri) => {
        opened.push(uri);
        return Promise.resolve({ languageId: "typescript" });
      },
      onDidChangeConfiguration: () => ({}),
    },
    Uri: {
      from: (parts: Omit<FakeUri, "toString">) => fakeUri(parts),
      parse: (text: string) =>
        fakeUri({ scheme: "file", path: text, query: "" }),
    },
    ViewColumn: { Beside: -2 },
    languages: { setTextDocumentLanguage: () => Promise.resolve() },
    window: {
      get activeTextEditor() {
        return editor.document === undefined ? undefined : editor;
      },
      showErrorMessage: (message: string) => errors.push(message),
      showInformationMessage: (message: string) => {
        infos.push(message);
        return Promise.resolve();
      },
      showTextDocument: () => Promise.resolve(),
      createOutputChannel: (_name: string, options: { log?: boolean }) => {
        assertEquals(
          options.log,
          true,
          "languageclient 10 requires a log output channel",
        );
        return {};
      },
    },
    commands: {
      registerCommand: (name: string, run: () => Promise<void>) => {
        commands.set(name, run);
        return {};
      },
    },
    EventEmitter: class {
      event = () => {};
      fire(uri: FakeUri) {
        fired.push(uri);
      }
    },
  };
  runInNewContext(Deno.readTextFileSync(new URL("extension.js", CLIENT)), {
    module,
    __dirname: "/installed/effektive",
    require: (name: string) => {
      if (name === "fs") return { existsSync: () => true };
      if (name === "path") return path;
      if (name === "vscode") return vscode;
      if (name === "vscode-languageclient/node") {
        return { LanguageClient: Client };
      }
      if (name === "child_process") {
        return {
          execFileSync: () => {
            if (denoVersion instanceof Error) throw denoVersion;
            return `deno ${denoVersion}\nv8 test\n`;
          },
        };
      }
      throw new Error(`unexpected dependency ${name}`);
    },
  });
  module.exports.activate!({ subscriptions: [] });
  return {
    errors,
    infos,
    launches,
    commands,
    notifications,
    opened,
    fired,
    editor,
  };
}

interface FakeUri {
  readonly scheme: string;
  readonly path: string;
  readonly query: string;
  toString(): string;
}

function fakeUri(parts: Omit<FakeUri, "toString">): FakeUri {
  return {
    ...parts,
    toString: () =>
      `${parts.scheme}:${parts.path}${parts.query ? `?${parts.query}` : ""}`,
  };
}

Deno.test("the installed client starts its bundled server without checkout configuration", () => {
  const { errors, launches } = activateClient({}, "2.9.8");
  assertEquals(errors, []);
  assertEquals(launches.length, 1);
  assertEquals(launches[0].command, "deno");
  assertEquals(Array.from(launches[0].args), [
    "run",
    "--no-config",
    "--no-lock",
    "--cached-only",
    "--allow-read",
    "--allow-write",
    "/installed/effektive/server/effektive-lsp.js",
  ]);
});

Deno.test("the client keeps an explicit checkout development override", () => {
  const { errors, launches } = activateClient({
    "server.repository": "/work/effektive",
    "server.deno": "/tools/deno",
  }, "2.9.8");
  assertEquals(errors, []);
  assertEquals(launches[0].command, "/tools/deno");
  assertEquals(Array.from(launches[0].args), [
    "run",
    "--allow-read",
    "--allow-write",
    "--config",
    "/work/effektive/deno.json",
    "/work/effektive/src/lsp/main.ts",
  ]);
});

Deno.test("missing or incompatible Deno prevents startup with an actionable error", () => {
  for (const version of ["2.9.6", "2.9.7", "3.0.0", new Error("ENOENT")]) {
    const { errors, launches } = activateClient({}, version);
    assertEquals(launches, []);
    assertEquals(errors.length, 1);
    assert(errors[0].includes("2.9.8"));
    assert(errors[0].includes("effektive.server.deno"));
    if (version instanceof Error) assert(errors[0].includes("ENOENT"));
  }
});

Deno.test("the generated view maps .eff to .ts and .effi to .effi.ts", async () => {
  const client = activateClient({}, "2.9.8");
  const show = client.commands.get("effektive.showGeneratedTypeScript");
  assert(show !== undefined, "the command must be registered");
  for (
    const [source, generated] of [
      ["/work/app/users.eff", "/work/app/users.ts"],
      ["/work/app/host.effi", "/work/app/host.effi.ts"],
    ]
  ) {
    const uri = fakeUri({ scheme: "file", path: source, query: "" });
    client.editor.document = { languageId: "effektive", uri };
    await show();
    const virtual = client.opened.at(-1);
    assertEquals(virtual?.scheme, GENERATED_SCHEME);
    assertEquals(virtual?.path, generated);
    assertEquals(virtual?.query, encodeURIComponent(uri.toString()));
  }
  assertEquals(client.infos, []);
  client.editor.document = {
    languageId: "effektive",
    uri: fakeUri({ scheme: "file", path: "/work/app/notes.txt", query: "" }),
  };
  await show();
  assertEquals(client.opened.length, 2);
  assertEquals(client.infos.length, 1);
});

Deno.test("a generatedChanged notification refreshes the .effi.ts view", () => {
  const client = activateClient({}, "2.9.8");
  const changed = client.notifications.get(GENERATED_CHANGED_METHOD);
  assert(changed !== undefined, "the notification must have a handler");
  changed({ uri: "/work/app/host.effi" });
  assertEquals(client.fired.map((uri) => uri.path), ["/work/app/host.effi.ts"]);
});
