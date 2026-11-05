import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import {
  checkProject,
  emitProject,
  type FunctionType,
  lowerProject,
  memoryHost,
  Program,
  type Revision,
} from "../src/core/mod.ts";
import { validateProject } from "../src/core/validate_project.ts";

const CONFIG = { "effektive.json": "{}" };

type Files = Readonly<Record<string, string>>;

function checked(files: Files, entries: readonly string[] = ["main.eff"]) {
  const result = checkProject(memoryHost({ ...CONFIG, ...files }), "", entries);
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

function codes(files: Files, entries?: readonly string[]): string[] {
  return checked(files, entries).diagnostics.map((diagnostic) =>
    diagnostic.code
  );
}

function functionType(
  revision: Revision,
  module: string,
  name: string,
): FunctionType {
  const built = revision.checkedModule(module)?.interface;
  assert(built?.ok, module);
  const value = built.value.payload.values.find((entry) => entry.name === name);
  assert(value?.type.kind === "function", `${module}.${name}`);
  return value.type;
}

function functionRequirements(
  project: ReturnType<typeof checked>,
  module: string,
  name: string,
): readonly string[] {
  const built = project.modules.get(module)?.interface;
  assert(built?.ok, module);
  const value = built.value.payload.values.find((entry) => entry.name === name);
  assert(value?.type.kind === "function", `${module}.${name}`);
  return value.type.effects.requirements;
}

Deno.test("a service header enables exported requirement inference", () => {
  const project = checked({
    "users-service.eff": `
export type User = { name: string }
export service Users { find(): User }
`,
    "main.eff": `
imports Users from "./users-service.eff"
import { User } from "./users-service.eff"
export const find = (): User => Users.find()
`,
  });
  assertEquals(project.diagnostics, []);
  const main = project.modules.get("main");
  assert(main?.interface.ok);
  const find = main.interface.value.payload.values.find((value) =>
    value.name === "find"
  );
  assert(find?.type.kind === "function");
  assertEquals(find.type.effects.requirements, [
    "cap:users-service#Users.find",
  ]);
  const lowered = lowerProject(project).get("main");
  assert(lowered?.ok);
  assertEquals(lowered.value.imports.length, 1);
  assertEquals(
    lowered.value.imports[0].bindings.map((binding) => binding.name),
    [
      "Users",
      "User",
    ],
  );
});

Deno.test("service headers reject invalid targets, positions, and interface files", () => {
  const services = `
export type User = { name: string }
export const value: User = User({ name: "x" })
export service Users { find(): User }
`;
  assertEquals(
    codes({
      "services.eff": services,
      "main.eff": `imports Missing from "./services.eff"\n`,
    }),
    ["unknown-name/002"],
  );
  assertEquals(
    codes({
      "services.eff": services,
      "main.eff": `imports value from "./services.eff"\n`,
    }),
    ["unknown-name/004"],
  );
  assert(
    codes({
      "services.eff": services,
      "main.eff": `imports Users other "./services.eff"\n`,
    }).includes("syntax/008"),
  );
  assertEquals(
    codes({
      "main.eff": `imports Users from "./missing.eff"\n`,
    }),
    ["module/002"],
  );
  assertEquals(
    codes({
      "services.eff": services,
      "main.eff": `
import { User } from "./services.eff"
imports Users from "./services.eff"
export const user: User = User({ name: "x" })
`,
    }),
    ["syntax/008"],
  );
  assertEquals(
    codes({
      "services.eff": services,
      "main.eff": `
imports Users from "./services.eff" trailing
type Int = int
export const ok = (): Int => 1
`,
    }),
    ["syntax/008"],
  );

  const config = JSON.stringify({
    host: { h: { interface: "./h.effi", module: "./h.ts" } },
  });
  assertEquals(
    codes({
      "effektive.json": config,
      "services.eff": services,
      "h.effi":
        `imports Users from "./services.eff"\nexport provider Live provides Users\n`,
      "main.eff": `import { Live } from "host:h"\n`,
    }),
    ["syntax/008"],
  );
});

Deno.test("service headers accept host paths and repeated declarations", () => {
  const config = JSON.stringify({
    host: { h: { interface: "./h.effi", module: "./h.ts" } },
  });
  const project = checked({
    "effektive.json": config,
    "h.effi": `
export type Int = int
export service Users { find(): Int }
export service Audit { write(): void }
`,
    "main.eff": `
// Headers can follow comments and blank lines.

imports Users from "host:h"
imports Audit from "host:h"
import { Int } from "host:h"
export const find = (): Int => { Audit.write(); Users.find() }
`,
  });
  assertEquals(project.diagnostics, []);
  assertEquals(functionRequirements(project, "main", "find"), [
    "cap:h#Audit.write",
    "cap:h#Users.find",
  ]);
});

Deno.test("service headers use existing duplicate bindings and keep imports contextual", () => {
  assertEquals(
    codes({
      "service.eff":
        `export type Int = int\nexport service Users { find(): Int }\n`,
      "main.eff": `
imports Users from "./service.eff"
imports Users from "./service.eff"
`,
    }),
    ["declaration/001"],
  );
  const project = checked({
    "main.eff": `
type Int = int
const imports = (): Int => 1
export const value = (): Int => imports()
`,
  });
  assertEquals(project.diagnostics, []);
  const imported = checked({
    "lib.eff": `
export type Int = int
export const imports = (): Int => 2
`,
    "main.eff": `
import { Int, imports } from "./lib.eff"
export const value = (): Int => imports()
`,
  });
  assertEquals(imported.diagnostics, []);
});

Deno.test("inference settles local, recursive, transitive, and imported calls", () => {
  const service = `
export type Int = int
export service Users { find(): Int }
`;
  const local = checked({
    "service.eff": service,
    "main.eff": `
imports Users from "./service.eff"
import { Int } from "./service.eff"
const leaf = (): Int => Users.find()
const middle = (): Int => leaf()
export const run = (): Int => middle()
export const even = (n: Int): Int => if (n > 0) { odd(n - 1) } else { Users.find() }
export const odd = (n: Int): Int => if (n > 0) { even(n - 1) } else { 0 }
`,
  });
  assertEquals(local.diagnostics, []);
  for (const name of ["run", "even", "odd"]) {
    assertEquals(functionRequirements(local, "main", name), [
      "cap:service#Users.find",
    ]);
  }

  const imported = checked({
    "service.eff": service,
    "lib.eff": `
imports Users from "./service.eff"
import { Int } from "./service.eff"
export const load = (): Int => Users.find()
`,
    "main.eff": `
imports Users from "./service.eff"
import { Int } from "./service.eff"
import { load } from "./lib.eff"
export const run = (): Int => load()
`,
  });
  assertEquals(imported.diagnostics, []);
  assertEquals(functionRequirements(imported, "main", "run"), [
    "cap:service#Users.find",
  ]);
});

Deno.test("the closed service set rejects undeclared direct and imported requirements", () => {
  const files = {
    "services.eff": `
export type Int = int
export service Allowed { read(): Int }
export service Users { find(): Int }
`,
    "lib.eff": `
imports Users from "./services.eff"
import { Int } from "./services.eff"
export const load = (): Int => Users.find()
`,
  };
  const directSource = `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const run = (): Int => Users.find()
`;
  const direct = checked({ ...files, "main.eff": directSource });
  assertEquals(direct.diagnostics.map((diagnostic) => diagnostic.code), [
    "requirement-contract/002",
  ]);
  assertEquals(
    direct.diagnostics[0].related?.map((note) =>
      directSource.slice(note.span.start, note.span.end)
    ),
    ["Users.find()"],
  );
  assertEquals(
    codes({
      ...files,
      "main.eff": `
imports Allowed from "./services.eff"
import { Int } from "./services.eff"
import { load } from "./lib.eff"
export const run = (): Int => load()
`,
    }),
    ["requirement-contract/002"],
  );
  assertEquals(
    codes({
      ...files,
      "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
const hidden = (): Int => Users.find()
export const run = (): Int => 1
`,
    }),
    ["requirement-contract/002"],
  );
});

Deno.test("unused headers, pure functions, and local services need no external service", () => {
  const project = checked({
    "service.eff":
      `export type Int = int\nexport service Users { find(): Int }\n`,
    "main.eff": `
imports Users from "./service.eff"
import { Int } from "./service.eff"
service Local { read(): Int }
export const pure = (): Int => 1
export const local = (): Int => Local.read()
`,
  });
  assertEquals(project.diagnostics, []);
  assertEquals(functionRequirements(project, "main", "pure"), []);
  assertEquals(functionRequirements(project, "main", "local"), [
    "cap:main#Local.read",
  ]);
});

Deno.test("provide removes the supplied service and keeps acquisition requirements", () => {
  const project = checked({
    "services.eff": `
export type Int = int
export service Config { read(): Int }
export service Users { find(): Int }
`,
    "main.eff": `
imports Config from "./services.eff"
import { Int, Users } from "./services.eff"
const live: Layer<Users, never, Config.read> = layer(Users, () => {
  const value = Config.read()
  ({ find: () => value })
})
export const run = (): Int => provide(live, () => Users.find())
`,
  });
  assertEquals(project.diagnostics, []);
  assertEquals(functionRequirements(project, "main", "run"), [
    "cap:services#Config.read",
  ]);
});

Deno.test("a service header preserves diagnostics for an invalid layer key", () => {
  assertEquals(
    codes({
      "service.eff":
        `export type Int = int\nexport service Users { find(): Int }\n`,
      "main.eff": `
imports Users from "./service.eff"
import { Int } from "./service.eff"
const live = layer(1, () => ({ find: (): Int => 1 }))
`,
    }),
    ["type-mismatch/010", "type-mismatch/010"],
  );
});

Deno.test("written bounds and modules without headers keep closed requirements", () => {
  const services = `
export type Int = int
export service Users { find(): Int }
export service Audit { write(): void }
`;
  assertEquals(
    codes({
      "services.eff": services,
      "main.eff": `
imports Users from "./services.eff"
imports Audit from "./services.eff"
import { Int } from "./services.eff"
export const run = (): Int with Audit.write => Users.find()
`,
    }),
    ["requirement-contract/001"],
  );
  assertEquals(
    codes({
      "services.eff": services,
      "main.eff": `
imports Users from "./services.eff"
imports Audit from "./services.eff"
import { Int } from "./services.eff"
export const run: () => Int with Audit.write = () => Users.find()
`,
    }),
    ["requirement-contract/001"],
  );
  assertEquals(
    codes({
      "services.eff": services,
      "main.eff": `
import { Int, Users } from "./services.eff"
export const run = (): Int => Users.find()
`,
    }),
    ["requirement-contract/001"],
  );
});

Deno.test("produced contracts are bounded but input-only contracts are excluded", () => {
  const project = checked({
    "services.eff": `
export type Int = int
export service Allowed { read(): Int }
export service Users { find(): Int }
`,
    "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
type Job = () => Int with Users.find
export const make = (): Effect<Int, never, Users.find> => defer(() => Users.find())
export const callback = (): () => Int with Users.find => () => Users.find()
export const aliased = (): Job => () => Users.find()
export const accept = (job: Effect<Int, never, Users.find>): Int => 1
`,
  });
  assertEquals(project.diagnostics.map((diagnostic) => diagnostic.code), [
    "requirement-contract/002",
    "requirement-contract/002",
    "requirement-contract/002",
  ]);
  assert(
    project.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("`aliased`")
    ),
  );
  assert(
    project.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("`make`")
    ),
  );
  assert(
    project.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("`callback`")
    ),
  );
  assertEquals(functionRequirements(project, "main", "accept"), []);
});

Deno.test("composite transfers preserve each input component origin", () => {
  const project = checked({
    "services.eff": `
export type Int = int
export service Users { read(): Int }
export service Allowed {
  record(input: {
    job: Effect<Int, never, Users.read>,
    other: Effect<Int, never, Users.read>
  }): void
  nested(input: { payload: { job: Effect<Int, never, Users.read> } }): void
  tuple(input: [Effect<Int, never, Users.read>, Effect<Int, never, Users.read>]): void
  list(input: Effect<Int, never, Users.read>[]): void
}
`,
    "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const forward = (
  input: { job: Effect<Int, never, Users.read>, other: Effect<Int, never, Users.read> },
  jobs: Effect<Int, never, Users.read>[]
): void => {
  const alias = input
  const copied = { ...alias }
  const { job } = copied
  Allowed.record({ job: input.job, other: input.other })
  Allowed.record({ job, other: input.other })
  Allowed.record({ ...input })
  Allowed.nested({ payload: { job: alias.job } })
  Allowed.tuple([input.job, input.other])
  Allowed.list([input.job, input.other])
  Allowed.list(jobs)
}
`,
  });
  assertEquals(project.diagnostics, []);
  const lowered = lowerProject(project);
  for (const result of lowered.values()) {
    assert(result.ok, JSON.stringify(result));
  }
  for (
    const diagnostics of validateProject(project.analysis.project, lowered)
      .values()
  ) assertEquals(diagnostics, []);
});

Deno.test("composite transfers retain fresh requirements with an inherited match", () => {
  const services = `
export type Int = int
export service Users { read(): Int }
export service Allowed {
  publish(input: {
    inherited: Effect<Int, never, Users.read>,
    fresh: Effect<Int, never, Users.read>
  }): void
}
`;
  for (
    const body of [
      `Allowed.publish({ ...input, fresh: defer(() => Users.read()) })`,
      `{
  const fresh = defer(() => Users.read())
  Allowed.publish({ inherited: input.inherited, fresh })
}`,
    ]
  ) {
    const project = checked({
      "services.eff": services,
      "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const forward = (input: {
  inherited: Effect<Int, never, Users.read>,
  fresh: Effect<Int, never, Users.read>
}): void => ${body}
`,
    });
    assertEquals(project.diagnostics.map((diagnostic) => diagnostic.code), [
      "requirement-contract/002",
    ], body);
  }
});

Deno.test("imported deferred values retain transferred requirements", () => {
  const services = `
export type Int = int
export service Users { read(): Int }
export service Allowed {
  publish(job: Effect<Int, never, Users.read>): void
  publishRecord(input: {
    inherited: Effect<Int, never, Users.read>,
    fresh: Effect<Int, never, Users.read>
  }): void
  publishPending(input: { pending: Effect<Int, never, Users.read> }): void
}
export const pending: Effect<Int, never, Users.read> = defer(() => Users.read())
export const replace = (
  previous: Effect<Int, never, Users.read>
): Effect<Int, never, Users.read> => pending
`;
  const cases = [
    `export const forward = (input: {
  inherited: Effect<Int, never, Users.read>,
  fresh: Effect<Int, never, Users.read>
}): void => Allowed.publish(pending)`,
    `export const forward = (input: {
  inherited: Effect<Int, never, Users.read>,
  fresh: Effect<Int, never, Users.read>
}): void => Allowed.publishRecord({ inherited: input.inherited, fresh: pending })`,
    `export const forward = (input: {
  inherited: Effect<Int, never, Users.read>,
  fresh: Effect<Int, never, Users.read>
}): void => Allowed.publishRecord({ ...input, fresh: pending })`,
    `export const forward = (): void => Allowed.publishPending({ pending })`,
    `export const forward = (input: {
  inherited: Effect<Int, never, Users.read>,
  fresh: Effect<Int, never, Users.read>
}): void => {
  const fresh = pending
  Allowed.publishRecord({ inherited: input.inherited, fresh })
}`,
    `export const forward = (
  target: Ref<Effect<Int, never, Users.read>>
): void => updateRef(target, replace)`,
    `export const forward = (
  target: Ref<Effect<Int, never, Users.read>>
): void => {
  const callbacks = { replace }
  updateRef(target, callbacks.replace)
}`,
  ];
  for (const declaration of cases) {
    const project = checked({
      "services.eff": services,
      "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users, pending, replace } from "./services.eff"
${declaration}
`,
    });
    assertEquals(project.diagnostics.map((diagnostic) => diagnostic.code), [
      "requirement-contract/002",
    ], declaration);
  }
});

Deno.test("recovery preserves deferred requirements after a missing spread value", () => {
  const project = checked({
    "services.eff": `
export type Int = int
export service Users { read(): Int }
export service Allowed { publish(job: Effect<Int, never, Users.read>): void }
`,
    "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const store = (): void => {
  const x: { job: Effect<Int, never, Users.read> } = { ... }
  Allowed.publish(x.job)
}
`,
  });
  assert(
    project.diagnostics.some((diagnostic) => diagnostic.category === "syntax"),
  );
  const requirements = project.diagnostics.filter((diagnostic) =>
    diagnostic.code === "requirement-contract/002"
  );
  assertEquals(requirements.length, 1);
  assertStringIncludes(requirements[0].message, "Users.read");
});

Deno.test("composite provenance agrees across fresh, warm, and retained revisions", () => {
  const services = `
export type Int = int
export service Users { read(): Int }
export service Allowed { publish(input: { job: Effect<Int, never, Users.read> }): void }
`;
  const source = (job: string): string => `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const forward = (input: { job: Effect<Int, never, Users.read> }): void =>
  Allowed.publish({ job: ${job} })
`;
  const inherited = source("input.job");
  const local = source("defer(() => Users.read())");
  const program = new Program("");
  const initial = program.update({
    set: { ...CONFIG, "services.eff": services, "main.eff": inherited },
  });
  assert(initial.ok, JSON.stringify(initial));
  assertEquals(initial.value.diagnostics, []);
  assertEquals(
    functionType(initial.value, "main", "forward").effects.requirements,
    [
      "cap:services#Allowed.publish",
    ],
  );

  const warm = program.update();
  assert(warm.ok, JSON.stringify(warm));
  assertEquals(warm.value.diagnostics, []);
  assertEquals(warm.value.rechecked, []);

  const changed = program.update({ set: { "main.eff": local } });
  assert(changed.ok, JSON.stringify(changed));
  assertEquals(changed.value.diagnostics.map((diagnostic) => diagnostic.code), [
    "requirement-contract/002",
  ]);
  assertEquals(
    functionType(changed.value, "main", "forward").effects.requirements,
    [
      "cap:services#Allowed.publish",
    ],
  );

  const delayed = initial.value.lowered("main");
  assert(delayed?.ok, JSON.stringify(delayed));
  assertEquals(initial.value.diagnostics, []);

  const reverted = program.update({ set: { "main.eff": inherited } });
  assert(reverted.ok, JSON.stringify(reverted));
  assertEquals(reverted.value.diagnostics, []);
  assertEquals(
    reverted.value.interfaceHash("main"),
    initial.value.interfaceHash("main"),
  );
  assertEquals(changed.value.diagnostics.map((diagnostic) => diagnostic.code), [
    "requirement-contract/002",
  ]);

  const fresh = new Program("").update({
    set: { ...CONFIG, "services.eff": services, "main.eff": local },
  });
  assert(fresh.ok, JSON.stringify(fresh));
  assertEquals(fresh.value.diagnostics.map((diagnostic) => diagnostic.code), [
    "requirement-contract/002",
  ]);
});

Deno.test("deferred writes through input references obey module service bounds", () => {
  const services = `
export type Int = int
export service Allowed { read(): Int }
export service Users { read(): Int }
`;
  const body = `
import { Int } from "./services.eff"
export const store = (target: Ref<Effect<Int, never, Users.read>>): void =>
  setRef(target, defer(() => Users.read()))
`;
  const undeclared = checked({
    "services.eff": services,
    "main.eff": `imports Allowed from "./services.eff"
import { Users } from "./services.eff"
${body}`,
  });
  assertEquals(undeclared.diagnostics.map((diagnostic) => diagnostic.code), [
    "requirement-contract/002",
  ]);
  const declared = checked({
    "services.eff": services,
    "main.eff": `imports Users from "./services.eff"\n${body}`,
  });
  assertEquals(declared.diagnostics, []);
  const inputOnly = checked({
    "services.eff": services,
    "main.eff": `imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const accept = (target: Ref<Effect<Int, never, Users.read>>): void => {}
`,
  });
  assertEquals(inputOnly.diagnostics, []);
});

Deno.test("deferred argument transfers include aliases, callbacks, and pipelines", () => {
  const services = `
export type Int = int
export service Users { read(): Int }
export service Allowed { publish(job: Effect<Int, never, Users.read>): void }
`;
  for (
    const expression of [
      "setRef(target, job)",
      "updateRef(target, previous => job)",
      "updateRef(target, callbacks.make)",
      "accept(job)",
      "job |> accept",
      "Allowed.publish(job)",
      "job |> Allowed.publish",
    ]
  ) {
    const project = checked({
      "services.eff": services,
      "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
const accept = (job: Effect<Int, never, Users.read>): void => {}
export const store = (target: Ref<Effect<Int, never, Users.read>>): void => {
  const job = defer(() => Users.read())
  const callbacks = {
    make: (previous: Effect<Int, never, Users.read>): Effect<Int, never, Users.read> => job
  }
  ${expression}
}
`,
    });
    assertEquals(project.diagnostics.map((diagnostic) => diagnostic.code), [
      "requirement-contract/002",
    ], expression);
    assertStringIncludes(project.diagnostics[0].message, "`store`");
  }
});

Deno.test("reference transfers preserve provision and input-only requirements", () => {
  const project = checked({
    "services.eff": `
export type Int = int
export service Allowed { read(): Int }
export service Users { read(): Int }
`,
    "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
const live: Layer<Users> = layer(Users, () => ({ read: () => 1 }))
const ignore = (target: Ref<Effect<Int, never, Users.read>>): void => {}
const ignoreJob = (job: Effect<Int, never, Users.read>): void => {}
export const forward = (target: Ref<Effect<Int, never, Users.read>>): void => {
  const alias = target
  ignore((alias))
  ignoreJob(getRef(target))
}
export const field = (input: { target: Ref<Effect<Int, never, Users.read>> }): void => {
  const { target } = input
  ignore(input.target)
  ignore(target)
}
export const unchanged = (target: Ref<Effect<Int, never, Users.read>>): void =>
  updateRef(target, previous => previous)
export const blockUpdate = (target: Ref<Effect<Int, never, Users.read>>): void =>
  updateRef(target, previous => { previous })
export const inputUpdate = (
  target: Ref<Effect<Int, never, Users.read>>,
  transform: (previous: Effect<Int, never, Users.read>) => Effect<Int, never, Users.read>
): void => updateRef(target, transform)
export const aliasedUpdate = (target: Ref<Effect<Int, never, Users.read>>): void => {
  const unchanged = (previous: Effect<Int, never, Users.read>): Effect<Int, never, Users.read> => previous
  updateRef(target, unchanged)
}
export const fieldUpdate = (target: Ref<Effect<Int, never, Users.read>>): void => {
  const callbacks = {
    unchanged: (previous: Effect<Int, never, Users.read>): Effect<Int, never, Users.read> => previous
  }
  updateRef(target, callbacks.unchanged)
  const copied = { ...callbacks }
  const { unchanged } = copied
  updateRef(target, copied.unchanged)
  updateRef(target, unchanged)
}
export const inspect = (target: Ref<Effect<Int, never, Users.read>>): void => {
  const ignored = getRef(target)
}
export const store = (target: Ref<Int>): void =>
  provide(live, () => setRef(target, Users.read()))
export const update = (target: Ref<Int>): void =>
  provide(live, () => updateRef(target, previous => Users.read()))
export const storedProvided = (target: Ref<Effect<Int, never, Users.read>>): void =>
  setRef(target, defer(() => provide(live, () => Users.read())))
`,
  });
  assertEquals(project.diagnostics, []);
});

Deno.test("provision does not hide a stored deferred requirement", () => {
  const project = checked({
    "services.eff": `
export type Int = int
export service Allowed { read(): Int }
export service Users { read(): Int }
`,
    "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
const live: Layer<Users> = layer(Users, () => ({ read: () => 1 }))
export const store = (
  target: Ref<{ tag: Int, job: Effect<Int, never, Users.read> }>,
  input: { tag: Int, job: Effect<Int, never, Users.read> }
): void =>
  provide(live, () => setRef(target, { ...input, job: defer(() => Users.read()) }))
`,
  });
  assertEquals(project.diagnostics.map((diagnostic) => diagnostic.code), [
    "requirement-contract/002",
  ]);
});

Deno.test("constant callbacks cannot store undeclared deferred values", () => {
  const project = checked({
    "services.eff": `
export type Int = int
export service Allowed { read(): Int }
export service Users { read(): Int }
`,
    "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const api: { store: (target: Ref<Effect<Int, never, Users.read>>) => void } = {
  store: target => {
    const payload = { job: defer(() => Users.read()) }
    setRef(target, payload.job)
  }
}
`,
  });
  assertEquals(project.diagnostics.map((diagnostic) => diagnostic.code), [
    "requirement-contract/002",
  ]);
  assertStringIncludes(project.diagnostics[0].message, "`api`");
});

Deno.test("produced constant contracts obey module service bounds", () => {
  const services = `
export type Int = int
export service Allowed { read(): Int }
export service Users { find(): Int }
`;
  const undeclared = checked({
    "services.eff": services,
    "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const pending: Effect<Int, never, Users.find> = defer(() => Users.find())
`,
  });
  assertEquals(undeclared.diagnostics.map((diagnostic) => diagnostic.code), [
    "requirement-contract/002",
  ]);
  assertStringIncludes(
    undeclared.diagnostics[0].message,
    "`pending` produces a value with undeclared service methods Users.find",
  );

  const declared = checked({
    "services.eff": services,
    "main.eff": `
imports Users from "./services.eff"
import { Int } from "./services.eff"
export const pending: Effect<Int, never, Users.find> = defer(() => Users.find())
`,
  });
  assertEquals(declared.diagnostics, []);
});

Deno.test("reserved scope capabilities do not need a service header", () => {
  const project = checked({
    "service.eff":
      `export type Int = int\nexport service Users { find(): Int }\n`,
    "main.eff": `
imports Users from "./service.eff"
export const spawn = (): void => forkScoped(defer(() => 1))
`,
  });
  assertEquals(project.diagnostics, []);
  assertEquals(functionRequirements(project, "main", "spawn"), [
    "cap:effect/Scope",
  ]);
});

Deno.test("module bounds retain active origins when a function bound is invalid", () => {
  const source = `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const mixed = (): Effect<Int, never, Users.find> with Allowed.read => {
  Users.find()
  defer(() => Users.find())
}
`;
  const project = checked({
    "services.eff": `
export type Int = int
export service Allowed { read(): Int }
export service Users { find(): Int }
`,
    "main.eff": source,
  });
  const diagnostic = project.diagnostics.find((entry) =>
    entry.code === "requirement-contract/002"
  );
  assert(diagnostic !== undefined);
  assertEquals(
    diagnostic.related?.map((note) =>
      source.slice(note.span.start, note.span.end)
    ),
    ["Users.find()"],
  );
});

Deno.test("inferred foreign service closure changes hashes and importers", () => {
  const services = `
export type Query = { text: string }
export type User = { name: string }
export service Users { find(query: Query): User }
`;
  const pureLib = `
imports Users from "./services.eff"
import { Query, User } from "./services.eff"
export const lookup = (query: Query): User => User({ name: query.text })
`;
  const requiredLib = pureLib.replace(
    "User({ name: query.text })",
    "Users.find(query)",
  );
  const program = new Program("");
  const firstResult = program.update({
    set: {
      ...CONFIG,
      "services.eff": services,
      "lib.eff": pureLib,
      "main.eff": `
imports Users from "./services.eff"
import { Query, User } from "./services.eff"
import { lookup } from "./lib.eff"
export const run = (query: Query): User => lookup(query)
`,
    },
  });
  assert(firstResult.ok, JSON.stringify(firstResult));
  const first = firstResult.value;
  assertEquals(first.diagnostics, []);
  assertEquals(functionType(first, "lib", "lookup").effects.requirements, []);

  const secondResult = program.update({ set: { "lib.eff": requiredLib } });
  assert(secondResult.ok, JSON.stringify(secondResult));
  const second = secondResult.value;
  assertEquals(second.diagnostics, []);
  assertEquals(second.rechecked, ["lib", "main"]);
  assertNotEquals(second.interfaceHash("lib"), first.interfaceHash("lib"));
  const type = functionType(second, "lib", "lookup");
  assertEquals(type.effects.requirements, ["cap:services#Users.find"]);
  const built = second.checkedModule("lib")?.interface;
  assert(built?.ok);
  const users = built.value.payload.services.find((service) =>
    service.id === "service:services#Users"
  );
  assert(users !== undefined);
  assertEquals(users.methods[0].type.parameters, [{
    kind: "named",
    id: "type:services#Query",
  }]);
  assertEquals(users.methods[0].type.result, {
    kind: "named",
    id: "type:services#User",
  });
  assertEquals(
    built.value.payload.types.map((entry) => entry.id),
    ["type:services#Query", "type:services#User"],
  );
});

Deno.test("service imports lower, validate, and emit", () => {
  const project = checked({
    "service.eff": `
export type Int = int
export service Users { find(): Int }
`,
    "main.eff": `
imports Users from "./service.eff"
import { Int } from "./service.eff"
export const find = (): Int => Users.find()
`,
  });
  assertEquals(project.diagnostics, []);
  const lowered = lowerProject(project);
  for (const result of lowered.values()) {
    assert(result.ok, JSON.stringify(result));
  }
  for (
    const diagnostics of validateProject(project.analysis.project, lowered)
      .values()
  ) assertEquals(diagnostics, []);
  const emitted = emitProject(lowered, {
    config: project.analysis.project.config,
  });
  for (const result of emitted.values()) {
    assert(result.ok, JSON.stringify(result));
  }
});
