import { assert, assertEquals } from "@std/assert";
import { type Doc, render } from "../src/core/emit/doc.ts";
import {
  fieldHelperDeclarations,
  needsFieldAdapter,
  taggedFields,
} from "../src/core/emit/fields.ts";
import { ModuleState } from "../src/core/emit/module_state.ts";
import type {
  Declaration,
  Field,
  ModuleIR,
  Type,
  TypeDecl,
} from "../src/core/ir.ts";

const span = { source: "main.eff", start: 0, end: 0 };
const int: Type = { kind: "primitive", name: "int" };
const named = (name: string): Type => ({
  kind: "named",
  id: `type:main#${name}`,
});
const field = (name: string, type: Type): Field => ({
  name,
  type,
  optional: false,
});
const alias = (name: string, type: Type): TypeDecl => ({
  kind: "type",
  id: `type:main#${name}`,
  name,
  definition: { kind: "alias", type },
  span,
});
const hidden = field("__proto__", int);
/** `Hidden` needs an adapter: its record has a field that the prototype also has. */
const hiddenDecl = alias("Hidden", { kind: "record", fields: [hidden] });
const scopeOf = (declarations: readonly Declaration[]) => {
  const ir: ModuleIR = {
    format: "light-functional-ir",
    version: 10,
    module: "main",
    sources: ["main.eff"],
    imports: [],
    declarations,
    exports: [],
  };
  return ModuleState(ir, { host: new Map() });
};

const rendered = (doc: Doc) => render(doc, undefined).text;
/** The text of the first adapter that `fieldHelperDeclarations` emits for one type. */
function adapterText(
  declarations: readonly Declaration[],
  type: Type,
  direction: "decoded" | "encoded" | "make" = "decoded",
): string {
  const scope = scopeOf(declarations);
  scope.fieldAdapter(type, direction);
  const top = fieldHelperDeclarations(scope).map(rendered).find((text) =>
    text.startsWith("function $fields(")
  );
  assert(top !== undefined, "the top adapter is missing");
  return top;
}

Deno.test("taggedFields gives the fields of a tagged nominal record only", () => {
  const base: Type = { kind: "record", fields: [field("kind", int)] };
  const decl = (definition: TypeDecl["definition"]): TypeDecl => ({
    ...alias("T", int),
    definition,
  });
  const forged = (definition: object) =>
    decl(definition as TypeDecl["definition"]);
  assertEquals(taggedFields(decl({ kind: "nominal", base, tagged: true })), [
    field("kind", int),
  ]);
  assertEquals(taggedFields(decl({ kind: "nominal", base })), undefined);
  assertEquals(
    taggedFields(forged({ kind: "nominal", base, tagged: false })),
    undefined,
  );
  assertEquals(
    taggedFields(forged({ kind: "alias", type: int, tagged: true })),
    undefined,
  );
});

Deno.test("needsFieldAdapter answers for each kind of named type and each leaf", () => {
  const cyclicPlain = alias("Plain", {
    kind: "record",
    fields: [field("next", { kind: "option", element: named("Plain") })],
  });
  const cyclicHidden = alias("Loop", {
    kind: "record",
    fields: [
      field("next", { kind: "option", element: named("Loop") }),
      hidden,
    ],
  });
  const error: Declaration = {
    kind: "error",
    id: "error:main#Boom",
    name: "Boom",
    fields: [hidden],
    span,
  };
  const scope = scopeOf([hiddenDecl, cyclicPlain, cyclicHidden, error]);
  assertEquals(needsFieldAdapter(scope, named("Hidden")), true);
  assertEquals(needsFieldAdapter(scope, named("Plain")), false);
  assertEquals(needsFieldAdapter(scope, named("Loop")), true);
  assertEquals(
    needsFieldAdapter(scope, { kind: "named", id: "error:main#Boom" }),
    false,
  );
  assertEquals(needsFieldAdapter(scope, named("Missing")), false);
  assertEquals(needsFieldAdapter(scope, { kind: "literal", value: 1 }), false);
  assertEquals(needsFieldAdapter(scope, int), false);
  assertEquals(
    needsFieldAdapter(scope, { kind: "record", fields: [hidden] }),
    true,
  );
  assertEquals(
    needsFieldAdapter(scope, {
      kind: "record",
      fields: [field("toString", int)],
    }),
    true,
  );
  assertEquals(
    needsFieldAdapter(scope, { kind: "record", fields: [field("ok", int)] }),
    false,
  );
});

const hiddenRef = named("Hidden");
const record = (fields: Field[]): Type => ({ kind: "record", fields });
const literal = (value: string): Type => ({ kind: "literal", value });
const boom: Declaration = {
  kind: "error",
  id: "error:main#Boom",
  name: "Boom",
  fields: [],
  span,
};
const ISRECORD =
  'if (typeof value !== "object" || value === null || globalThis.Array.isArray(value)) return value;';

Deno.test("an adapter body follows the kind of its type", () => {
  const declarations = [hiddenDecl, boom];
  const cases: readonly (readonly [string, Type, string])[] = [
    [
      "a named type adapts its definition",
      hiddenRef,
      `function $fields(value: unknown): unknown {
return $fields$1(value);
}`,
    ],
    [
      "a named error keeps its value",
      { kind: "named", id: "error:main#Boom" },
      `function $fields(value: unknown): unknown {
return value;
}`,
    ],
    [
      "an unknown name keeps its value",
      named("Missing"),
      `function $fields(value: unknown): unknown {
return value;
}`,
    ],
    [
      "an option maps its element",
      { kind: "option", element: hiddenRef },
      `function $fields(value: unknown): unknown {
return Option.isOption(value) ? Option.map(value, item => $fields$1(item)) : value;
}`,
    ],
    [
      "an array maps its element",
      { kind: "array", element: hiddenRef },
      `function $fields(value: unknown): unknown {
return globalThis.Array.isArray(value) ? value.map(item => $fields$1(item)) : value;
}`,
    ],
    [
      "a tuple switches on the index",
      { kind: "tuple", elements: [int, hiddenRef] },
      `function $fields(value: unknown): unknown {
return globalThis.Array.isArray(value) ? value.map((item, index) => { switch (index) { case 0: return item; case 1: return $fields$1(item); default: return item; } }) : value;
}`,
    ],
    [
      "a leaf keeps its value",
      int,
      `function $fields(value: unknown): unknown {
return value;
}`,
    ],
    [
      "a record redefines each field that needs an adapter",
      record([field("a", hiddenRef), field("b", int)]),
      `function $fields(value: unknown): unknown {
${ISRECORD}
const out = $record<{ [key: string]: unknown }>(value);
if (globalThis.Object.hasOwn(out, "a")) globalThis.Object.defineProperty(out, "a", { value: $fields$1(out["a"]), enumerable: true, configurable: true, writable: true });
return out;
}`,
    ],
    [
      "a union with no tag adapts its members in sequence",
      { kind: "union", members: [hiddenRef, int] },
      `function $fields(value: unknown): unknown {
return $fields$1(value);
}`,
    ],
    [
      "a union of tagged records selects the branch by tag",
      {
        kind: "union",
        members: [
          record([field("n", int), field("kind", literal("a")), hidden]),
          record([field("kind", literal("b")), field("x", hiddenRef)]),
        ],
      },
      `function $fields(value: unknown): unknown {
if (typeof value === "object" && value !== null && globalThis.Reflect.get(value, "kind") === "a") return $fields$1(value);
if (typeof value === "object" && value !== null && globalThis.Reflect.get(value, "kind") === "b") return $fields$2(value);
return value;
}`,
    ],
    [
      "a union with one untagged member adapts in sequence",
      {
        kind: "union",
        members: [
          record([field("kind", literal("a")), hidden]),
          hiddenRef,
        ],
      },
      `function $fields(value: unknown): unknown {
return $fields$2($fields$1(value));
}`,
    ],
  ];
  for (const [label, type, expected] of cases) {
    assertEquals(adapterText(declarations, type), expected, label);
  }
});
