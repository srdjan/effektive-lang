import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";

function checkInterface(
  source: string,
  extra: Readonly<Record<string, string>> = {},
) {
  const checked = checkProject(
    memoryHost({
      "effektive.json": JSON.stringify({
        host: { numbers: { interface: "./host.effi", module: "./host.ts" } },
      }),
      "host.effi": source,
      "host.ts": "export {};",
      "main.eff":
        'import { Numbers } from "host:numbers"\nexport const ready = (): void => {}',
      ...extra,
    }),
    "",
    ["main.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  return checked.value.diagnostics;
}

Deno.test("host interfaces reject declared and imported refined contracts", () => {
  const direct = checkInterface(`
export type Positive = int where n => n > 0
export service Numbers { bad(): Positive }
`);
  assert(direct.some((diagnostic) => diagnostic.code === "declaration/018"));
  const imported = checkInterface(
    `
import { Positive } from "./domain.eff"
export type Hidden = Positive[]
export error Bad = { values: Hidden }
export service Numbers { bad(): Effect<Option<Positive>> fails Bad }
`,
    { "domain.eff": "export type Positive = int where n => n > 0" },
  );
  assert(imported.some((diagnostic) => diagnostic.code === "declaration/018"));
  const provider = checkInterface(
    `
import { Domain } from "./domain.eff"
export service Numbers { raw(): unknown }
export provider DomainLive provides Domain
`,
    {
      "domain.eff":
        "export type Positive = int where n => n > 0\nexport service Domain { read(): Positive }",
    },
  );
  assert(provider.some((diagnostic) => diagnostic.code === "declaration/018"));
});

Deno.test("host interfaces retain unrefined unknown contracts", () => {
  assertEquals(checkInterface("export service Numbers { raw(): unknown }"), []);
});

Deno.test("a refined host contract gets declaration/018 at the declaration that exposes it", () => {
  const message =
    "declaration/018 host interfaces must expose unrefined data; use a checked source entry";
  const located = (source: string, extra: Record<string, string> = {}) =>
    checkInterface(source, extra).map((d) =>
      `${d.code} ${d.message} ${d.span.source}:${d.span.start}-${d.span.end}`
    );
  assertEquals(
    located(`
export type Positive = int where n => n > 0
export service Numbers { bad(): Positive }
`),
    [`${message} host.effi:1-44`, `${message} host.effi:70-85`],
  );
  assertEquals(
    located(
      `
import { Positive } from "./domain.eff"
export type Hidden = Positive[]
export error Bad = { values: Hidden }
export service Numbers { bad(): Effect<Option<Positive>> fails Bad }
`,
      { "domain.eff": "export type Positive = int where n => n > 0" },
    ),
    [
      `${message} host.effi:41-72`,
      `${message} host.effi:73-110`,
      `${message} host.effi:136-177`,
    ],
  );
  assertEquals(
    located(
      `
import { Domain } from "./domain.eff"
export service Numbers { raw(): unknown }
export provider DomainLive provides Domain
`,
      {
        "domain.eff":
          "export type Positive = int where n => n > 0\nexport service Domain { read(): Positive }",
      },
    ),
    [`${message} host.effi:81-123`],
  );
});
