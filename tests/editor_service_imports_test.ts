import { assert, assertEquals } from "@std/assert";
import {
  applySourceEdits,
  completionsAt,
  contractActionsAt,
  definitionAt,
  inlayHintsAt,
  Program,
  referencesAt,
  renameAt,
  semanticClassifications,
  sourceHoverAt,
} from "../src/core/frontend.ts";

const services = `export type Text = string
export type Int = int
export service Users { read(id: Text): Text }
export service Audit { write(value: Text): void }
export service Clock { now(): Int }
`;

const source = `imports Users from "./services.eff"
import { Text } from "./services.eff"
export const fetch = (id: Text): Text => Users.read(id)
`;

function load(main = source) {
  const loaded = new Program("").update({
    set: {
      "effektive.json": "{}",
      "services.eff": services,
      "m.eff": main,
    },
  });
  assert(loaded.ok, JSON.stringify(loaded));
  return loaded.value;
}

Deno.test("a service header reuses its service binding for editor queries", () => {
  const revision = load();
  assertEquals(revision.diagnostics, []);
  const header = source.indexOf("Users");
  const declaration = services.indexOf("Users");
  assertEquals(definitionAt(revision, "m.eff", header), {
    source: "services.eff",
    start: declaration,
    end: declaration + "Users".length,
  });
  assertEquals(
    referencesAt(revision, "m.eff", header).map((span) => span.source),
    ["m.eff", "m.eff", "services.eff"],
  );
  assertEquals(
    sourceHoverAt(revision, "m.eff", header)?.contract,
    "service Users",
  );

  const renamed = renameAt(revision, "m.eff", header, "Accounts");
  assert(renamed.ok, JSON.stringify(renamed));
  assertEquals(renamed.value.length, 3);
  const next = new Program("").update({
    set: {
      "effektive.json": "{}",
      "services.eff": applySourceEdits(
        services,
        renamed.value.filter((edit) => edit.span.source === "services.eff"),
      ),
      "m.eff": applySourceEdits(
        source,
        renamed.value.filter((edit) => edit.span.source === "m.eff"),
      ),
    },
  });
  assert(next.ok, JSON.stringify(next));
  assertEquals(next.value.diagnostics, []);
});

Deno.test("service header completion reads exported services from its source path", () => {
  const text = `imports Us from "./services.eff"
import { Text } from "./services.eff"
`;
  const labels = completionsAt(load(text), "m.eff", text.indexOf("Us") + 2)
    .map((item) => item.label);
  assertEquals(labels, ["Users"]);
  const blank = `imports  from "./services.eff"
`;
  assertEquals(
    completionsAt(load(blank), "m.eff", "imports ".length).map((item) =>
      item.label
    ),
    ["Audit", "Clock", "Users"],
  );

  const empty = "imp";
  assert(
    completionsAt(load(empty), "m.eff", empty.length).some((item) =>
      item.label === "imports" && item.kind === "keyword"
    ),
  );
  const late = `import { Text } from "./services.eff"
imp`;
  assert(
    !completionsAt(load(late), "m.eff", late.length).some((item) =>
      item.label === "imports"
    ),
  );
  const repeated = `imports Users from "./services.eff"; imp`;
  assert(
    completionsAt(load(repeated), "m.eff", repeated.length).some((item) =>
      item.label === "imports"
    ),
  );
});

Deno.test("semantic classification marks only a valid service-header imports word", () => {
  const text = `imports Users from "./services.eff"
import { Text } from "./services.eff"
const imports = 1
imports Audit from "./services.eff"
`;
  const revision = load(text);
  const imports = semanticClassifications(revision, "m.eff", text).filter((
    item,
  ) => text.slice(item.span.start, item.span.end) === "imports");
  assertEquals(imports.map((item) => item.type), [
    "keyword",
    "variable",
    "variable",
  ]);
  const fallback = semanticClassifications(undefined, "m.eff", text).filter((
    item,
  ) => text.slice(item.span.start, item.span.end) === "imports");
  assertEquals(fallback.map((item) => item.type), [
    "keyword",
    "variable",
    "variable",
  ]);
});

Deno.test("inlay hints show inferred exported requirements from service headers", () => {
  const hints = inlayHintsAt(load(), "m.eff", { start: 0, end: source.length });
  assertEquals(hints, [{
    position: source.indexOf(": Text =>") + ": Text".length,
    label: " with Users.read",
  }]);
  assert(
    sourceHoverAt(load(), "m.eff", source.indexOf("fetch"))?.contract.endsWith(
      " with Users.read",
    ),
  );
});

Deno.test("contract actions cannot write around the service import bound", () => {
  const text = `imports Users from "./services.eff"
import { Clock, Int } from "./services.eff"
export const run = (): Int with never => Clock.now()
`;
  const revision = load(text);
  assert(
    revision.diagnostics.some((diagnostic) =>
      diagnostic.code === "requirement-contract/001"
    ),
  );
  assertEquals(
    contractActionsAt(
      revision,
      "m.eff",
      text.indexOf("run"),
      text.length,
      true,
    ),
    [],
  );
  const written = text.replace("with never", "with Clock.now");
  assert(
    load(written).diagnostics.some((diagnostic) =>
      diagnostic.code === "requirement-contract/002"
    ),
  );
});
