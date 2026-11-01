// Proves that the checker keeps the guards of the Schema builtins. The first
// part checks programs and requires the exact diagnostics: the recursion guard
// of `schemaRecursive`, the expected type of `schema()`, and the input type of
// `schemaEncode` and `schemaDecode`. The second part forges the IR of a valid
// module and requires the exact validator diagnostics for a Schema operation
// over a Schema value that it must reject. These tests kill the mutants of
// `recursionRoleOf`, `expectedSchema`, `schemaOperationCall`, and
// `guardedSchemaCallback` in `src/core/check_builtins/schema.ts`, and of
// `schemaOperation` in `src/core/validate/families/schema.ts`.

import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";
import type { ModuleIR } from "../src/core/ir.ts";
import { allExprs, diagnosticsOf, forgedModule } from "./helpers.ts";

interface Case {
  readonly name: string;
  readonly source: string;
  /** Each entry is `code message`. */
  readonly expected: readonly string[];
}

const HEAD = `type Int = int
type Text = string
error Other = {}
const text: Schema<Text> = schema()
const integer: Schema<Int> = schema()
`;

const TREE = `type Tree = { kind: "end" } | { kind: "more", next: Tree }
type EndTag = "end"
type MoreTag = "more"
const endTag: Schema<EndTag> = schema()
const moreTag: Schema<MoreTag> = schema()
`;

const more = "schemaStruct({ kind: moreTag, next: self })";

const CASES: readonly Case[] = [
  {
    name:
      "a recursive callback with a body that is not a Schema builtin call rejects self",
    source: HEAD +
      "const bad: Schema<Text> = schemaRecursive((self: Schema<Text>) => fail(self))\n",
    expected: [
      "execution-mode/001 the callback of `schemaRecursive` must be pure with empty failure and requirement sets",
      "type-mismatch/010 recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
      "type-mismatch/010 `fail` needs a value of a named error type, but the value has type Schema<Text, Text, never, never>",
    ],
  },
  {
    name: "a recursive Schema that is not a callback reports the missing guard",
    source: HEAD + "const bad: Schema<Text> = schemaRecursive(text)\n",
    expected: [
      "type-mismatch/010 recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
      "type-mismatch/010 the callback of `schemaRecursive` must be a function, but the value has type Schema<Text, Text, never, never>",
    ],
  },
  {
    name: "a recursive callback with no parameter reports the missing guard",
    source: HEAD + TREE +
      "const bad: Schema<Tree> = schemaRecursive(() => schemaStruct({ kind: moreTag, next: schemaConstructorDefault(text, (v: Text): Text => v) }))\n",
    expected: [
      "type-mismatch/003 recursive schema body does not fit its expected Schema",
      "type-mismatch/004 the callback of `schemaRecursive` takes 1 parameter, but the function takes 0",
      "type-mismatch/010 recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
      "type-mismatch/004 the callback of `schemaConstructorDefault` takes 0 parameters, but the function takes 1",
    ],
  },
  {
    name:
      "a recursive callback whose body is an array Schema reports the missing guard",
    source: HEAD +
      "const bad: Schema<Int[]> = schemaRecursive((self: Schema<Int[]>): Schema<Int[]> => schemaArray(self))\n",
    expected: [
      "type-mismatch/010 recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
      "type-mismatch/003 the function body has type Schema<Int[][], Int[][], never, never>, but Schema<Int[], Int[], never, never> is expected",
    ],
  },
  {
    name:
      "self beneath a Schema builtin that cannot carry it reports the missing guard",
    source: HEAD + TREE +
      "const bad: Schema<Tree> = schemaRecursive((self: Schema<Tree>): Schema<Tree> => schemaStruct({ kind: moreTag, next: schemaArray(self), last: schemaOptionFromOptionalKey(self) }))\n",
    expected: [
      "type-mismatch/010 recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
      "type-mismatch/003 the function body has type Schema<{ kind: MoreTag, last: Option<Tree>, next: Tree[] }, { kind: MoreTag, last?: Tree, next: Tree[] }, never, never>, but Schema<Tree, Tree, never, never> is expected",
    ],
  },
  {
    name:
      "a union with a tag that is not a string literal reports the missing guard",
    source: HEAD +
      `type YesTag = true
type NoTag = false
type Flagged = { ok: YesTag } | { ok: NoTag, next: Flagged }
const yes: Schema<YesTag> = schema()
const no: Schema<NoTag> = schema()
const bad: Schema<Flagged> = schemaRecursive((self: Schema<Flagged>): Schema<Flagged> => schemaUnion([schemaStruct({ ok: yes }), schemaStruct({ ok: no, next: self })]))
`,
    expected: [
      "declaration/007 the type `Flagged` is defined in terms of itself",
      "type-mismatch/010 recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
    ],
  },
  {
    name:
      "a union branch with a literal decoded tag and a wider encoded tag reports the missing guard",
    source: HEAD + TREE +
      `const wireEnd: Schema<EndTag, Text> = schemaTransform(text, endTag, (t: Text): Option<EndTag> => Some("end"), (e: EndTag): Option<Text> => Some("end"))
const bad: Schema<Tree> = schemaRecursive((self: Schema<Tree>): Schema<Tree> => schemaUnion([schemaStruct({ kind: wireEnd }), ${more}]))
`,
    expected: [
      "type-mismatch/010 recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
      "type-mismatch/003 the function body has type Schema<{ kind: EndTag } | { kind: MoreTag, next: Tree }, { kind: MoreTag, next: Tree } | { kind: Text }, never, never>, but Schema<Tree, Tree, never, never> is expected",
    ],
  },
  {
    name:
      "a union branch with a record decoded type and a text encoded type reports the missing guard",
    source: HEAD + TREE +
      `const endStruct: Schema<{ kind: EndTag }> = schemaStruct({ kind: endTag })
const wireRecord: Schema<{ kind: EndTag }, Text> = schemaTransform(text, endStruct, (t: Text): Option<{ kind: EndTag }> => Some({ kind: "end" }), (e: { kind: EndTag }): Option<Text> => Some("end"))
const bad: Schema<Tree> = schemaRecursive((self: Schema<Tree>): Schema<Tree> => schemaUnion([wireRecord, ${more}]))
`,
    expected: [
      "type-mismatch/010 recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
      "type-mismatch/003 the function body has type Schema<{ kind: EndTag } | { kind: MoreTag, next: Tree }, { kind: MoreTag, next: Tree } | Text, never, never>, but Schema<Tree, Tree, never, never> is expected",
    ],
  },
  {
    name:
      "a union branch whose encoded record lacks a decoded field reports the missing guard",
    source: HEAD + TREE +
      `const endStruct: Schema<{ kind: EndTag }> = schemaStruct({ kind: endTag })
const wireStruct: Schema<{ tag: EndTag }> = schemaStruct({ tag: endTag })
const renamed: Schema<{ kind: EndTag }, { tag: EndTag }> = schemaTransform(wireStruct, endStruct, (w: { tag: EndTag }): Option<{ kind: EndTag }> => Some({ kind: "end" }), (e: { kind: EndTag }): Option<{ tag: EndTag }> => Some({ tag: "end" }))
const bad: Schema<Tree> = schemaRecursive((self: Schema<Tree>): Schema<Tree> => schemaUnion([renamed, ${more}]))
`,
    expected: [
      "type-mismatch/010 recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
      "type-mismatch/003 the function body has type Schema<{ kind: EndTag } | { kind: MoreTag, next: Tree }, { kind: MoreTag, next: Tree } | { tag: EndTag }, never, never>, but Schema<Tree, Tree, never, never> is expected",
    ],
  },
  {
    name: "a schema with a non-data decoded type is not compiler-derived",
    source: HEAD +
      "const bad: Schema<Effect<Int>, Int, never, never, Int> = schema()\n",
    expected: [
      "type-mismatch/010 Schema decoded and encoded types must be data only",
      "type-mismatch/003 `schema()` needs an identity Schema with no services",
      "type-mismatch/010 Schema data must be compiler-derived",
      "type-mismatch/010 schema does not yet preserve constructor make-input metadata",
    ],
  },
  {
    name: "a schema with a non-data make input is not compiler-derived",
    source: HEAD +
      "const bad: Schema<Int, Int, never, never, Effect<Int>> = schema()\n",
    expected: [
      "type-mismatch/010 Schema decoded and encoded types must be data only",
      "type-mismatch/010 Schema data must be compiler-derived",
      "type-mismatch/010 schema does not yet preserve constructor make-input metadata",
    ],
  },
  {
    name:
      "schemaEncode and schemaMake give an empty list its expected type and schemaDecode does not",
    source: HEAD + `const ints: Schema<Int[]> = schemaArray(integer)
export const enc = (): Int[] fails SchemaError => schemaEncode(ints, [])
export const mk = (): Int[] fails SchemaIssue => schemaMake(ints, [])
export const dec = (): Int[] fails SchemaError => schemaDecode(ints, [])
`,
    expected: [
      "type-mismatch/012 an empty list needs an expected array or tuple type",
    ],
  },
];

Deno.test("the checker reports each Schema guard with its exact diagnostics", () => {
  for (const c of CASES) {
    assertEquals(diagnosticsOf(c.source), c.expected, c.name);
  }
});

const OPERATION_SOURCE = `type Int = int
const first: Schema<Int> = schema()
const second: Schema<Int> = schema()
export const decodeInt = (): Int fails SchemaError => schemaDecode(first, 1)
export const makeInt = (): Int fails SchemaIssue => schemaMake(second, 1)
`;

/** Add `patch` to the declared type of a constant and to each reference to it. */
function forgeConstant(
  ir: ModuleIR,
  name: string,
  patch: Record<string, unknown>,
): void {
  const found = ir.declarations.find((d) =>
    d.kind === "constant" && d.name === name
  );
  assert(found?.kind === "constant", name);
  Object.assign(found.type, patch);
  for (const ref of allExprs(ir, "reference")) {
    if (ref.target === `value:m#${name}`) Object.assign(ref.type, patch);
  }
}

Deno.test("schemaDecode rejects a Schema with a constructor default", () => {
  assertEquals(
    forgedModule(
      OPERATION_SOURCE,
      (ir) => forgeConstant(ir, "first", { constructorDefault: true }),
    ),
    [
      "validation/002 declarations[1].value: the initializer type Schema<type:m#Int, type:m#Int, never, never> does not fit the constant type SchemaConstructorDefault<type:m#Int, type:m#Int, never, never>",
      "validation/002 declarations[3].body: schema runner needs an ordinary Schema value",
    ],
  );
});

Deno.test("schemaMake rejects a Schema with an encodedOptionalKey", () => {
  assertEquals(
    forgedModule(
      OPERATION_SOURCE,
      (ir) => forgeConstant(ir, "second", { encodedOptionalKey: true }),
    ),
    [
      "validation/002 declarations[2].value: the initializer type Schema<type:m#Int, type:m#Int, never, never> does not fit the constant type SchemaEncodedOptional<type:m#Int, type:m#Int, never, never>",
      "validation/002 declarations[4].body: schema runner needs an ordinary Schema value",
    ],
  );
});

Deno.test("schemaDecode accepts a Schema with an optionalKey", () => {
  assertEquals(
    forgedModule(
      OPERATION_SOURCE,
      (ir) => forgeConstant(ir, "first", { optionalKey: true }),
    ),
    [
      "validation/002 declarations[1].value: the initializer type Schema<type:m#Int, type:m#Int, never, never> does not fit the constant type SchemaOptional<type:m#Int, type:m#Int, never, never>",
    ],
  );
});

const SEALED_LIBRARY = `export sealed type Positive = int
export const positiveSchema: Schema<Positive> = schema()
`;

const SEALED_CONSUMER = `import { Positive, positiveSchema } from "./lib.eff"
export const decoded = (input: unknown): Positive fails SchemaError => schemaDecode(positiveSchema, input)
export const made = (input: Positive): Positive fails SchemaIssue => schemaMake(positiveSchema, input)
`;

Deno.test("a consumer names schemaDecode or schemaMake when it runs a Schema of a foreign sealed type", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "lib.eff": SEALED_LIBRARY,
      "main.eff": SEALED_CONSUMER,
    }),
    "",
    ["main.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(
    checked.value.diagnostics.map((d) => `${d.code} ${d.message}`),
    [
      "sealed/004 only the declaring module can run schemaDecode for a sealed type",
      "sealed/004 only the declaring module can run schemaMake for a sealed type",
    ],
  );
});
