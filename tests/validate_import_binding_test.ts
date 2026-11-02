// Tests of the producer binding in `validateProject`. A consumer IR carries a
// copy of each export that it imports. The validator compares that copy with
// the producer IR of the same call. The tests mix IR of two revisions, as a
// stale build artifact does.

import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  type LowerError,
  lowerProject,
  memoryHost,
  type ModuleIR,
  Program,
  type Result,
} from "../src/core/mod.ts";
import { exampleFiles } from "./helpers.ts";
import { validateRevision } from "./validate_helpers.ts";
import { validateProject } from "../src/core/validate_project.ts";

const CONSUMER = [
  'import { Count, zero, Counter } from "./lib.eff"',
  "export const next = (): Count => zero()",
  "",
].join("\n");

function libraryOf(count: string, zero: string): string {
  return [
    `export type Count = ${count}`,
    "export error Bad = { code: int }",
    "export service Counter { bump(n: Count): Count fails Bad }",
    `export const zero = (): Count => ${zero}`,
    "",
  ].join("\n");
}

function lowered(files: Readonly<Record<string, string>>) {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", ...files }),
    "",
    ["main.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics, []);
  const modules = lowerProject(checked.value);
  for (const result of modules.values()) assert(result.ok);
  return { project: checked.value.analysis.project, modules };
}

function irOf(
  modules: ReadonlyMap<string, Result<ModuleIR, LowerError>>,
  name: string,
): ModuleIR {
  const found = modules.get(name);
  assert(found?.ok, `no IR for ${name}`);
  return found.value;
}

function messagesOf(
  project: Parameters<typeof validateProject>[0],
  modules: ReadonlyMap<string, Result<ModuleIR, LowerError>>,
  name: string,
): string[] {
  return (validateProject(project, modules).get(name) ?? []).map((item) =>
    `${item.code} ${item.message}`
  );
}

Deno.test("a consumer and its producer of the same revision validate", () => {
  const base = lowered({
    "lib.eff": libraryOf("int", "Count(0)"),
    "main.eff": CONSUMER,
  });
  assertEquals(messagesOf(base.project, base.modules, "main"), []);
  assertEquals(messagesOf(base.project, base.modules, "lib"), []);
});

Deno.test("a consumer IR of an old producer is rejected against a new producer", () => {
  const old = lowered({
    "lib.eff": libraryOf("int", "Count(0)"),
    "main.eff": CONSUMER,
  });
  const current = lowered({
    "lib.eff": libraryOf("string", 'Count("")'),
    "main.eff": CONSUMER,
  });
  const mixed = new Map(current.modules);
  mixed.set("main", { ok: true, value: irOf(old.modules, "main") });
  assertEquals(messagesOf(current.project, mixed, "main"), [
    'validation/009 imports[0]: the import of lib in main differs from the producer lib at type:lib#Count.definition.base.name: the import has "int", the producer has "string"',
  ]);
});

Deno.test("a consumer IR is rejected when the producer changed the failures of a method", () => {
  const old = lowered({
    "lib.eff": libraryOf("int", "Count(0)"),
    "main.eff": CONSUMER,
  });
  const current = lowered({
    "lib.eff": libraryOf("int", "Count(0)").replace(" fails Bad", ""),
    "main.eff": CONSUMER,
  });
  const mixed = new Map(current.modules);
  mixed.set("main", { ok: true, value: irOf(old.modules, "main") });
  assertEquals(messagesOf(current.project, mixed, "main"), [
    "validation/009 imports[0]: the import of lib in main differs from the producer lib at service:lib#Counter.methods[0].type.effects.failures: the import has 1 items, the producer has 0 items",
  ]);
});

Deno.test("an import of a host module is not compared with a producer", () => {
  const loaded = new Program().update({ set: exampleFiles() });
  assert(loaded.ok);
  const revision = loaded.value;
  const modules = new Map(
    revision.moduleNames().flatMap((name) => {
      const found = revision.lowered(name);
      return found === undefined ? [] : [[name, found] as const];
    }),
  );
  const main = irOf(modules, "main");
  const hostImport = main.imports.find((item) =>
    item.module === "host:providers"
  );
  assert(hostImport !== undefined);
  assert(modules.has("host/providers"));
  const forged: ModuleIR = {
    ...main,
    imports: main.imports.map((item) =>
      item === hostImport ? { ...item, types: [] } : item
    ),
  };
  modules.set("main", { ok: true, value: forged });
  const found = validateRevision(revision, modules).get("main") ?? [];
  assertEquals(
    found.filter((item) => item.code === "validation/009"),
    [],
  );
});

Deno.test("an import whose producer is absent from the call is not compared", () => {
  const old = lowered({
    "lib.eff": libraryOf("int", "Count(0)"),
    "main.eff": CONSUMER,
  });
  const current = lowered({
    "lib.eff": libraryOf("string", 'Count("")'),
    "main.eff": CONSUMER,
  });
  const partial = new Map([["main", {
    ok: true as const,
    value: irOf(old.modules, "main"),
  }]]);
  assertEquals(messagesOf(current.project, partial, "main"), []);
});

/** The 009 lines for `main` after `forge` changes the lib import payload of its IR. */
function forgedLines(forge: (payload: Record<string, unknown>) => void) {
  const base = lowered({
    "lib.eff": libraryOf("int", "Count(0)"),
    "main.eff": CONSUMER,
  });
  const forged = structuredClone(irOf(base.modules, "main"));
  const payload = forged.imports.find((item) => item.module === "lib");
  assert(payload !== undefined);
  forge(payload as unknown as Record<string, unknown>);
  const modules = new Map(base.modules);
  modules.set("main", { ok: true, value: forged });
  return messagesOf(base.project, modules, "main").filter((line) =>
    line.startsWith("validation/009")
  );
}

function methodType(payload: Record<string, unknown>): Record<string, unknown> {
  const services = payload.services as Record<string, unknown>[];
  const methods = services[0].methods as Record<string, unknown>[];
  return methods[0].type as Record<string, unknown>;
}

const FORGED_CASES: readonly (readonly [
  name: string,
  forge: (payload: Record<string, unknown>) => void,
  expected: readonly string[],
])[] = [
  [
    "an array replaced by a string",
    (payload) => {
      (methodType(payload).effects as Record<string, unknown>).failures = "x";
    },
    [
      'validation/009 imports[0]: the import of lib in main differs from the producer lib at service:lib#Counter.methods[0].type.effects.failures: the import has "x", the producer has 1 items',
    ],
  ],
  [
    "an array removed",
    (payload) => {
      delete methodType(payload).parameters;
    },
    [
      "validation/009 imports[0]: the import of lib in main differs from the producer lib at service:lib#Counter.methods[0].type.parameters: the import has no value, the producer has 1 items",
    ],
  ],
  [
    "an object removed",
    (payload) => {
      delete methodType(payload).effects;
    },
    [
      "validation/009 imports[0]: the import of lib in main differs from the producer lib at service:lib#Counter.methods[0].type.effects: the import has no value, the producer has an object",
    ],
  ],
  [
    "an object replaced by a string",
    (payload) => {
      (payload.types as Record<string, unknown>[])[0].definition = "x";
    },
    [
      'validation/009 imports[0]: the import of lib in main differs from the producer lib at type:lib#Count.definition: the import has "x", the producer has an object',
    ],
  ],
  [
    "an execution mode",
    (payload) => {
      methodType(payload).execution = "pure";
    },
    [
      'validation/009 imports[0]: the import of lib in main differs from the producer lib at service:lib#Counter.methods[0].type.execution: the import has "pure", the producer has "effect"',
    ],
  ],
  [
    "an export that the producer lacks",
    (payload) => {
      (payload.exports as string[]).push("type:lib#Gone");
    },
    [
      "validation/009 imports[0]: the import of lib in main differs from the producer lib at type:lib#Gone: the import has an export, the producer has none",
    ],
  ],
  [
    "a binding to an export that the producer lacks",
    (payload) => {
      (payload.bindings as Record<string, unknown>[])[0].target =
        "type:lib#Gone";
    },
    [
      "validation/009 imports[0]: the import of lib in main differs from the producer lib at type:lib#Gone: the import binds Count, the producer has no such export",
    ],
  ],
  [
    "a declaration of the producer that the producer lacks",
    (payload) => {
      const types = payload.types as Record<string, unknown>[];
      types.push({ ...types[0], id: "type:lib#Ghost", name: "Ghost" });
    },
    [
      "validation/009 imports[0]: the import of lib in main differs from the producer lib at type:lib#Ghost: the import has an object, the producer has no value",
    ],
  ],
  [
    "a declaration of another module that the producer does not carry",
    (payload) => {
      const types = payload.types as Record<string, unknown>[];
      types.push({ ...types[0], id: "type:other#Ghost", name: "Ghost" });
    },
    [],
  ],
  [
    "a declaration with a malformed identity",
    (payload) => {
      const types = payload.types as Record<string, unknown>[];
      types.push({ ...types[0], id: "lib#Ghost", name: "Ghost" });
    },
    [],
  ],
  [
    "a span that differs",
    (payload) => {
      const types = payload.types as { span: Record<string, number> }[];
      types[0].span.end += 5;
    },
    [],
  ],
];

for (const [name, forge, expected] of FORGED_CASES) {
  Deno.test(`a forged lib import payload is compared with the producer: ${name}`, () => {
    assertEquals(forgedLines(forge), expected);
  });
}

Deno.test("a type that a producer carries from a third module is compared with that copy", () => {
  const base = lowered({
    "util.eff": "export type Id = int\n",
    "lib.eff":
      'import { Id } from "./util.eff"\nexport const make = (): Id => Id(1)\n',
    "main.eff":
      'import { make } from "./lib.eff"\nconst held = make()\nexport const one = (): Num => 1\ntype Num = int\n',
  });
  const forged = structuredClone(irOf(base.modules, "main"));
  const payload = forged.imports.find((item) => item.module === "lib");
  assert(payload !== undefined);
  const carried = payload.types.find((item) => item.id === "type:util#Id");
  assert(carried?.definition.kind === "nominal");
  Object.assign(carried.definition, { sealed: true });
  const modules = new Map(base.modules);
  modules.set("main", { ok: true, value: forged });
  assertEquals(
    messagesOf(base.project, modules, "main").filter((line) =>
      line.startsWith("validation/009")
    ),
    [
      "validation/009 imports[0]: the import of lib in main differs from the producer lib at type:util#Id.definition.sealed: the import has true, the producer has no value",
    ],
  );
});

Deno.test("a module under the key of a host or prelude import does not become its producer", () => {
  const loaded = new Program().update({ set: exampleFiles() });
  assert(loaded.ok);
  const revision = loaded.value;
  const modules = new Map(
    revision.moduleNames().flatMap((name) => {
      const found = revision.lowered(name);
      return found === undefined ? [] : [[name, found] as const];
    }),
  );
  const decoy = modules.get("collections");
  assert(decoy !== undefined);
  modules.set("host:providers", decoy);
  modules.set("effektive:prelude", decoy);
  const found = validateRevision(revision, modules);
  assertEquals(
    ["main", "users", "log"].flatMap((name) =>
      (found.get(name) ?? []).filter((item) => item.code === "validation/009")
    ),
    [],
  );
});
