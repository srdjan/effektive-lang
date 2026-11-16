// Tests that kill older mutation survivors of the Schema emitter.

import { assert, assertStringIncludes } from "@std/assert";
import { emitModule } from "../src/core/typescript.ts";
import { loweredModule } from "./helpers.ts";

function emittedText(source: string): string {
  const result = emitModule(loweredModule(source), {
    config: { host: new Map() },
  });
  assert(result.ok, JSON.stringify(result));
  return result.value.text;
}

const DEFAULTS = `type Text = string
type Nil = null
type Nullable = Text | Nil
type Encoded = { name?: Nullable }
type Decoded = { name: Text }
type Missing = { name?: Text }
const text: Schema<Text> = schema()
const pure: Schema<Decoded, Encoded> = schemaStruct({ name: schemaDefaultKey(text, (): Text => "Ada", { on: "null" }) })
const failing: Schema<Decoded, Encoded> = schemaStruct({ name: schemaDefaultKey(text, (): Text fails SchemaError => schemaDecode(text, "x"), { on: "null" }) })
const omitted: Schema<Decoded, Encoded> = schemaStruct({ name: schemaDefaultKey(text, (): Text => "Ada", { on: "null", encodingStrategy: "omit" }) })
`;
const MISSING_KEY =
  `const missing: Schema<Decoded, Missing> = schemaStruct({ name: schemaDefaultKey(text, (): Text => "Ada") })
`;
const ENCODED_KEY =
  `const encoded: Schema<Decoded, Missing> = schemaStruct({ name: schemaDefaultKey(text, (): Text => "Ada", { on: "encoded" }) })
`;

Deno.test("a null default maps a SchemaError of its callback and passes the encoding through unless it omits", () => {
  const text = emittedText(DEFAULTS);
  assertStringIncludes(
    text,
    `Effect.map(Effect.sync(() => (() =>
    "Ada")()), Option.some); }), encode: SchemaGetter.passthrough() })))(text).ast),`,
  );
  assertStringIncludes(
    text,
    `Effect.map(Effect.mapError(Effect.suspend(() => (() =>
    Schema.decodeUnknownEffect(text)("x"))()), ($t0) => $t0.issue), Option.some); }), encode: SchemaGetter.passthrough() })))(text).ast),`,
  );
  assertStringIncludes(
    text,
    `Effect.map(Effect.sync(() => (() =>
    "Ada")()), Option.some); }), encode: SchemaGetter.omit() })))(text).ast),`,
  );
});

Deno.test("a missing-key default uses the type-key Schema default", () => {
  assertStringIncludes(
    emittedText(DEFAULTS + MISSING_KEY),
    `(text.pipe(Schema.withDecodingDefaultTypeKey(Effect.sync(() => (() =>
    "Ada")()))).ast),`,
  );
});

Deno.test("an encoded-key default uses the key Schema default", () => {
  assertStringIncludes(
    emittedText(DEFAULTS + ENCODED_KEY),
    `(text.pipe(Schema.withDecodingDefaultKey(Effect.sync(() => (() =>
    "Ada")()))).ast),`,
  );
});

Deno.test("schemaDecode and schemaEncode adapt their input to the encoded and the decoded type", () => {
  const text = emittedText(`type Text = string
type Proto = { __proto__: Text }
const text: Schema<Text> = schema()
const proto: Schema<Proto> = schemaStruct({ __proto__: text })
const wire: Schema<Text, Proto> = schemaTransform(
  proto,
  text,
  (value: Proto): Option<Text> => Some(value.__proto__),
  (value: Text): Option<Proto> => Some({ __proto__: value })
)
const model: Schema<Proto, Text> = schemaTransform(
  text,
  proto,
  (value: Text): Option<Proto> => Some({ __proto__: value }),
  (value: Proto): Option<Text> => Some(value.__proto__)
)
export const dec = (input: unknown): Text fails SchemaError => schemaDecode(wire, input)
export const enc = (input: Text): Proto fails SchemaError => schemaEncode(wire, input)
export const dec2 = (input: unknown): Proto fails SchemaError => schemaDecode(model, input)
export const enc2 = (input: Proto): Text fails SchemaError => schemaEncode(model, input)
`);
  assertStringIncludes(
    text,
    `Schema.decodeUnknownEffect(wire)($fields(input));`,
  );
  assertStringIncludes(text, `Schema.encodeEffect(wire)(input);`);
  assertStringIncludes(text, `Schema.decodeUnknownEffect(model)(input);`);
  assertStringIncludes(
    text,
    `Schema.encodeEffect(model)($record<Proto>(input, $fields$1));`,
  );
});
