// Tests that kill older mutation survivors of the type emitter.

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

const SCHEMA_SOURCE = `type Text = string
type Exact = SchemaOptional<Text>
type EncodedOnly = SchemaEncodedOptional<Option<Text>, Text>
type DecodedOnly = SchemaDecodedOptional<Text>
`;

Deno.test("a schema type states the optionality of the decoded and encoded keys", () => {
  const text = emittedText(SCHEMA_SOURCE);
  assertStringIncludes(
    text,
    `type Exact = (Schema.Codec<
  Text,
  Text,
  never,
  never
> & { readonly "~type.make.in": Text; readonly "~type.optionality": "optional"; readonly "~encoded.optionality": "optional"; readonly "~type.constructor.default": "no-default" });`,
  );
  assertStringIncludes(
    text,
    `type EncodedOnly = (Schema.Codec<
  Option.Option<Text>,
  Text,
  never,
  never
> & { readonly "~type.make.in": Option.Option<Text>; readonly "~type.optionality": "required"; readonly "~encoded.optionality": "optional"; readonly "~type.constructor.default": "no-default" });`,
  );
  assertStringIncludes(
    text,
    `type DecodedOnly = (Schema.Codec<
  Text,
  Text,
  never,
  never
> & { readonly "~type.make.in": Text; readonly "~type.optionality": "optional"; readonly "~encoded.optionality": "required"; readonly "~type.constructor.default": "no-default" });`,
  );
});
