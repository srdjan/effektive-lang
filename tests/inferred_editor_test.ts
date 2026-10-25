import { assert, assertEquals } from "@std/assert";
import {
  applySourceEdits,
  contractActionsAt,
  inlayHintsAt,
  Program,
  sourceHoverAt,
} from "../src/core/frontend.ts";

const source = `type Text = string
const consume = (value: Text): Text => value
const local = (input): Text => consume(input.name)
export const omitted = (input): Text fails SchemaError => consume(input.name)
export const explicit = (input: unknown): Text fails SchemaError => consume(input.name)
`;

Deno.test("editor queries show finalized inferred input contracts", () => {
  const loaded = new Program().update({
    set: { "effektive.json": "{}", "m.eff": source },
  });
  assert(loaded.ok);
  assertEquals(loaded.value.diagnostics, []);
  for (const name of ["local", "omitted", "explicit"]) {
    assert(
      sourceHoverAt(loaded.value, "m.eff", source.indexOf(name))?.contract
        .includes("input: { name: Text }"),
    );
  }

  const hints = inlayHintsAt(loaded.value, "m.eff", {
    start: 0,
    end: source.length,
  });
  const omitted = source.indexOf("input): Text", source.indexOf("omitted")) +
    "input".length;
  const explicit = source.indexOf(
    "input: unknown",
    source.indexOf("explicit"),
  ) + "input: unknown".length;
  assertEquals(
    hints.find((hint) => hint.position === omitted)?.label,
    ": { name: Text }",
  );
  assertEquals(
    hints.find((hint) => hint.position === explicit)?.label,
    " validated: { name: Text }",
  );
  assertEquals(
    inlayHintsAt(loaded.value, "m.eff", { start: explicit, end: explicit }),
    [{ position: explicit, label: " validated: { name: Text }" }],
  );
});

Deno.test("contract actions preserve inferred checked entry parameters", () => {
  for (const parameter of ["input", "input: unknown"]) {
    const text = `type Text = string
const consume = (value: Text): Text => value
export const entry = (${parameter}): Text => consume(input.name)
`;
    const loaded = new Program().update({
      set: { "effektive.json": "{}", "m.eff": text },
    });
    assert(loaded.ok);
    const action = contractActionsAt(
      loaded.value,
      "m.eff",
      text.indexOf("entry"),
    )[0];
    assert(action !== undefined);
    const changed = applySourceEdits(text, action.edits);
    assert(changed.includes(`(${parameter}): Text fails SchemaError`));

    const checked = new Program().update({
      set: { "effektive.json": "{}", "m.eff": changed },
    });
    assert(checked.ok);
    assertEquals(checked.value.diagnostics, []);
    const lowered = checked.value.lowered("m");
    assert(lowered?.ok);
    const entry = lowered.value.declarations.find((declaration) =>
      declaration.kind === "function" && declaration.name === "entry"
    );
    assert(entry?.kind === "function");
    assertEquals(entry.type.checked, [true]);
    assertEquals(entry.entryValidation, [entry.parameters[0].id]);
  }
});
