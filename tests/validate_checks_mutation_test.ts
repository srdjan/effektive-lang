// Mutation tests for the IR validator checks of declarations, imports, and
// deferred fields (declaration_checks.ts, import_checks.ts, type_checks.ts).
// Each test lowers one accepted program, changes one fact of a copy of the IR
// in memory, and requires the exact diagnostics of the validator. The first
// assertion of each test is that the unchanged IR validates.

import { assert, assertEquals } from "@std/assert";
import type { Import, ModuleIR, Type } from "../src/core/ir.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import { validateModule } from "../src/core/validate/index.ts";

const FILES: Record<string, string> = {
  "effektive.json": JSON.stringify({
    host: { files: { interface: "./host.effi", module: "./host.ts" } },
  }),
  "host.effi": `export opaque type Handle
export type Text = string
export service Files {
  open(): Handle
  read(borrow handle: Handle): Text
}
`,
  "m.eff": `import { Handle, Text, Files } from "host:files"
type Int = int
type Box = { count: Int }
error Failed = { count: Int }
type Boxed = Box | Failed
type Jobs = [Effect<Int>, Effect<Int>]
const jobs: Jobs = [defer(() => 1), defer(() => 2)]
const doubled = (xs: Int[]): Int[] => map(xs, (n) => n + 1)
const kept = (xs: Int[]): Int[] => filter(xs, (n) => n > 1)
const both = (): [Int, Int] => all(jobs)
`,
};

const INT: Type = { kind: "named", id: "type:m#Int" };
const STRING: Type = { kind: "primitive", name: "string" };
const UNKNOWN: Type = { kind: "primitive", name: "unknown" };

const lowered = (() => {
  const checked = checkProject(memoryHost(FILES), "", ["m.eff"]);
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics, []);
  const result = lowerProject(checked.value).get("m");
  assert(result?.ok === true, JSON.stringify(result));
  return result.value;
})();

/** Validates a copy of the IR after `change`, and shows each diagnostic as `code path: message`. */
function forged(change: (ir: ModuleIR) => void): string[] {
  const ir = structuredClone(lowered);
  change(ir);
  return validateModule(ir, new Map(Object.entries(FILES))).map((d) =>
    `${d.code} ${d.message}`
  );
}

function importOf(ir: ModuleIR, module: string): Import {
  const found = ir.imports.find((i) => i.module === module);
  assert(found !== undefined, module);
  return found;
}

function builtinOf(ir: ModuleIR, name: string) {
  const found = importOf(ir, "effektive:prelude").values.find((v) =>
    v.name.startsWith(`$builtin/${name}/`)
  );
  assert(found?.type.kind === "function", name);
  return found.type;
}

function declared(ir: ModuleIR, name: string) {
  const found = ir.declarations.find((d) => d.name === name);
  assert(found !== undefined, name);
  return found;
}

Deno.test("the unchanged program validates", () => {
  assertEquals(forged(() => {}), []);
});

// ------------------------------------------------------------ service borrows

Deno.test("a service borrow parameter of a named type that is not opaque is rejected", () => {
  assertEquals(
    forged((ir) => {
      const method = importOf(ir, "host:files").services[0].methods[1];
      Object.assign(method.type.parameters, [
        { kind: "named", id: "type:host#Text" },
      ]);
    }),
    [
      "validation/002 imports[0].services[0].methods[1].borrows[0]: a borrow parameter needs an opaque type",
    ],
  );
});

// ------------------------------------------------------------- opaque bases

Deno.test("an opaque type with an alias definition is rejected", () => {
  assertEquals(
    forged((ir) => {
      Object.assign(importOf(ir, "host:files").types[0], {
        definition: { kind: "alias", type: UNKNOWN },
      });
    }),
    [
      "validation/002 imports[0].types[0].definition: an opaque type needs an unknown nominal base",
    ],
  );
});

Deno.test("an opaque type with a nominal string base is rejected", () => {
  assertEquals(
    forged((ir) => {
      Object.assign(importOf(ir, "host:files").types[0], {
        definition: { kind: "nominal", base: STRING },
      });
    }),
    [
      "validation/002 imports[0].types[0].definition: an opaque type needs an unknown nominal base",
    ],
  );
});

// ------------------------------------------------------------ builtin shapes

Deno.test("the builtin all must carry the failures of its Effects", () => {
  assertEquals(
    forged((ir) => {
      Object.assign(builtinOf(ir, "all").effects, {
        failures: ["error:m#Failed"],
      });
    }),
    [
      "validation/002 imports[1].values[0].type: the builtin all must carry the failures and requirements of every Effect",
      "validation/003 declarations[8].type.effects.failures: an inferred contract equals the body: expected [error:m#Failed], recorded []",
      "validation/003 declarations[8].body.effects.failures: expected [error:m#Failed], recorded []",
    ],
  );
});

Deno.test("the builtin all must run as an Effect", () => {
  assertEquals(
    forged((ir) => {
      Object.assign(builtinOf(ir, "all"), { execution: "pure" });
    }),
    [
      "validation/002 imports[1].values[0].type: the builtin all must carry the failures and requirements of every Effect",
      "validation/004 declarations[8].type.execution: expected pure, recorded effect",
      "validation/004 declarations[8].body.execution: expected pure, recorded effect",
    ],
  );
});

Deno.test("the builtin map rejects a callback with two parameters", () => {
  assertEquals(
    forged((ir) => {
      const callback = builtinOf(ir, "map").parameters[1];
      assert(callback.kind === "function");
      Object.assign(callback.parameters, [INT, INT]);
    }),
    [
      "validation/002 imports[1].values[2].type: the builtin map passes the callback an element that is not the element type",
      "validation/002 declarations[6].body.arguments[1]: the argument has type (type:m#Int) => type:m#Int [pure], which does not fit the parameter (type:m#Int, type:m#Int) => type:m#Int [pure]",
    ],
  );
});

Deno.test("the builtin map must return an array of the callback result", () => {
  assertEquals(
    forged((ir) => {
      Object.assign(builtinOf(ir, "map"), {
        result: { kind: "array", element: STRING },
      });
    }),
    [
      "validation/002 imports[1].values[2].type: the builtin map returns an array of the callback result",
      "validation/002 declarations[6].body.type: expected string[], recorded type:m#Int[]",
      "validation/002 declarations[6].body: the body type string[] does not fit the declared result type:m#Int[]",
    ],
  );
});

Deno.test("the builtin filter rejects a callback that does not return a boolean", () => {
  assertEquals(
    forged((ir) => {
      const callback = builtinOf(ir, "filter").parameters[1];
      assert(callback.kind === "function");
      Object.assign(callback, { result: INT });
    }),
    [
      "validation/002 imports[1].values[1].type: the builtin filter returns the array type with a boolean predicate",
      "validation/002 declarations[7].body.arguments[1]: the argument has type (type:m#Int) => boolean [pure], which does not fit the parameter (type:m#Int) => type:m#Int [pure]",
    ],
  );
});

// ---------------------------------------------------------- import payloads

Deno.test("an import payload id that starts with a colon claims this module's identity", () => {
  assertEquals(
    forged((ir) => {
      Object.assign(importOf(ir, "host:files").types[1], { id: ":m#Text" });
    }),
    [
      "validation/001 imports[0].types[1].id: an import payload cannot claim this module's identity :m#Text",
      "validation/001 imports[0].services[0].methods[1].type.result: the type type:host#Text is not declared",
      "validation/001 imports[0].exports[2]: the module host:files exports type:host#Text, which its payload does not declare",
    ],
  );
});

Deno.test("the prelude import with only a binding is rejected", () => {
  assertEquals(
    forged((ir) => {
      const prelude = importOf(ir, "effektive:prelude");
      const map = prelude.values.find((v) =>
        v.name.startsWith("$builtin/map/")
      );
      assert(map !== undefined);
      Object.assign(prelude.bindings, [{ name: "x", target: map.id }]);
    }),
    [
      "validation/001 imports[1]: the prelude import has no bindings, types, errors, or services",
    ],
  );
});

// ---------------------------------------------------------- deferred fields

const DEFERRED = "has a function or deferred type";

function nested(levels: number, leaf: Type): Type {
  let type = leaf;
  for (let i = 0; i < levels; i++) type = { kind: "array", element: type };
  return type;
}

/** The deferred-field diagnostics after `type` replaces the field of `Box`. */
function deferredFields(type: Type): string[] {
  return forged((ir) => {
    const box = declared(ir, "Box");
    assert(box.kind === "type" && box.definition.kind === "nominal");
    assert(box.definition.base.kind === "record");
    Object.assign(box.definition.base.fields[0], { type });
  }).filter((line) => line.includes(DEFERRED));
}

const FIELD =
  "validation/002 declarations[1].definition.base.fields[0].type: the field count has a function or deferred type, which a tagged record or error declaration cannot hold";

Deno.test("a function below the depth bound makes a tagged field deferred", () => {
  const fn: Type = {
    kind: "function",
    execution: "pure",
    parameters: [],
    result: { kind: "primitive", name: "int" },
    effects: { failures: [], requirements: [] },
  };
  assertEquals(deferredFields(nested(1537, fn)), [FIELD]);
});

Deno.test("a data type below the depth bound does not make a tagged field deferred", () => {
  assertEquals(deferredFields(nested(1538, INT)), []);
});

Deno.test("the builtin filter must return the array type of its input", () => {
  assertEquals(
    forged((ir) => {
      Object.assign(builtinOf(ir, "filter"), {
        result: { kind: "array", element: STRING },
      });
    }),
    [
      "validation/002 imports[1].values[1].type: the builtin filter returns the array type with a boolean predicate",
      "validation/002 declarations[7].body.type: expected string[], recorded type:m#Int[]",
      "validation/002 declarations[7].body: the body type string[] does not fit the declared result type:m#Int[]",
    ],
  );
});

Deno.test("the prelude import with only a service is rejected", () => {
  assertEquals(
    forged((ir) => {
      const service = importOf(ir, "host:files").services[0];
      Object.assign(importOf(ir, "effektive:prelude").services, [service]);
    }),
    [
      "validation/001 imports[1]: the prelude import has no bindings, types, errors, or services",
    ],
  );
});
