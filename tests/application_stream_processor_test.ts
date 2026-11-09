import { assert } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";
import { assertValidProject } from "./helpers.ts";
const base = new URL(
  "../fixtures/applications/stream-processor/",
  import.meta.url,
);
const files = Object.fromEntries(
  ["effektive.json", "contracts.eff", "processor.eff"].map((
    name,
  ) => [name, Deno.readTextFileSync(new URL(name, base))]),
);
const failures = ["InputFailure", "TransformFailure", "OutputFailure"];
const services = ["Input", "Transform", "Output"];
function checked(source = files["processor.eff"]) {
  const result = checkProject(
    memoryHost({ ...files, "processor.eff": source }),
    "",
    ["processor.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
Deno.test("stream processor validates linked IR with all deferred failure and service channels", () => {
  const project = checked();
  assertValidProject(project);
});
Deno.test("stream processor rejects erased exported failure, service and result contracts", () => {
  const source = files["processor.eff"];
  const start = source.indexOf("export const runProcessor");
  const prefix = source.slice(0, start);
  const exported = source.slice(start);
  for (const failure of failures) {
    const erased = exported.replace(
      "with " + services.join(" | "),
      "fails " + failures.filter((name) => name !== failure).join(" | ") +
        "\n  with " + services.join(" | "),
    );
    assert(
      checked(prefix + erased).diagnostics.some((d) =>
        d.code === "failure-contract/001"
      ),
      failure,
    );
  }
  for (const service of services) {
    const erased = exported.replace(
      "with " + services.join(" | "),
      "with " + services.filter((name) => name !== service).join(" | "),
    );
    assert(
      checked(prefix + erased).diagnostics.some((d) =>
        d.code === "requirement-contract/001"
      ),
      service,
    );
  }
  assert(
    checked(prefix + exported.replace("(): void", "(): Int")).diagnostics.some((
      d,
    ) => d.category === "type-mismatch"),
  );
});
