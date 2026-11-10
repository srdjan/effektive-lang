import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";
import { assertValidProject } from "./helpers.ts";
const base = new URL(
  "../fixtures/applications/service-workflow/",
  import.meta.url,
);
const files = Object.fromEntries(
  ["effektive.json", "contracts.eff", "host.effi", "workflow.eff"].map((
    name,
  ) => [name, Deno.readTextFileSync(new URL(name, base))]),
);
function checked(source = files["workflow.eff"]) {
  const result = checkProject(
    memoryHost({ ...files, "workflow.eff": source }),
    "",
    ["workflow.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
Deno.test("service workflow validates and retains provider requirements while discharging Store", () => {
  const project = checked();
  assertValidProject(project);
});
Deno.test("service workflow rejects erased result, failure and retained service contracts", () => {
  // The service headers bound the requirements, so a written `with` clause is
  // an optional checked bound. Each case below changes that written bound.
  const bounded = files["workflow.eff"].replace(
    "(input: unknown): Receipt =>",
    "(input: unknown): Receipt\n  with Catalog | Runtime =>",
  );
  for (
    const [error, remaining] of [
      ["SchemaError", "InvalidOrder | CatalogFailure | StoreFailure"],
      ["InvalidOrder", "SchemaError | CatalogFailure | StoreFailure"],
      ["CatalogFailure", "SchemaError | InvalidOrder | StoreFailure"],
      ["StoreFailure", "SchemaError | InvalidOrder | CatalogFailure"],
    ]
  ) {
    const source = bounded.replace(
      "with Catalog | Runtime",
      "fails " + remaining + "\n  with Catalog | Runtime",
    );
    assert(
      checked(source).diagnostics.some((d) =>
        d.code === "failure-contract/001"
      ),
      error,
    );
  }
  for (const service of ["Catalog", "Runtime"]) {
    const source = bounded.replace(
      "with Catalog | Runtime",
      "with " +
        (service === "Catalog" ? "Runtime" : "Catalog"),
    );
    assert(
      checked(source).diagnostics.some((d) =>
        d.code === "requirement-contract/001"
      ),
      service,
    );
  }
  assert(
    checked(
      files["workflow.eff"].replace(
        "(input: unknown): Receipt",
        "(input: unknown): Receipt[]",
      ),
    ).diagnostics.some((d) => d.category === "type-mismatch"),
  );
});

Deno.test("service workflow rejects a service that no imports header bounds", () => {
  const source = files["workflow.eff"].replace(
    'imports Runtime from "host:store"\n',
    'import { Runtime } from "host:store"\n',
  );
  assertEquals(
    checked(source).diagnostics.map((d) => `${d.code} ${d.message}`),
    [
      "requirement-contract/002 `submit` requires undeclared service methods Runtime.database",
    ],
  );
});
