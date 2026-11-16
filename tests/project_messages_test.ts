// Tests for the exact text of each effektive.json shape message and each project loader message.

import { assert, assertEquals } from "@std/assert";
import { memoryHost, type SourceHost } from "../src/core/frontend.ts";
import { loadProject } from "../src/core/project.ts";
import { parseConfig } from "../src/core/project_config.ts";

function shapeError(text: string): unknown {
  const result = parseConfig(text);
  return result.ok ? "accepted" : result.error;
}

function invalidShape(message: string) {
  return { tag: "invalid-shape", path: "effektive.json", message: message };
}

Deno.test("each effektive.json shape error gives its exact message", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["[]", "the top level must be an object"],
    ['{"imports":3}', "`imports` must be an array"],
    [
      '{"imports":[{"allow":[]}]}',
      "imports entry 1 needs a string `from`",
    ],
    [
      '{"imports":[{"from":3,"allow":[]}]}',
      "imports entry 1 needs a string `from`",
    ],
    [
      '{"imports":[{"from":"a","allow":3}]}',
      "imports entry 1 needs a string array `allow`",
    ],
    [
      '{"imports":[{"from":"a","allow":[1]}]}',
      "imports entry 1 needs a string array `allow`",
    ],
    [
      '{"imports":[{"from":"a","allow":["a@b"]}]}',
      "imports entry 1 has an invalid `allow` pattern `a@b`",
    ],
    [
      '{"imports":[{"from":"a","allow":[]},{"from":"b","allow":["c","a@b"]}]}',
      "imports entry 2 has an invalid `allow` pattern `a@b`",
    ],
    ['{"host":3}', "`host` must be an object"],
    ['{"host":{"a":3}}', "host entry `a` must be an object"],
    [
      '{"host":{"a":{"module":"./x.ts"}}}',
      "host entry `a` needs a string `interface`",
    ],
    [
      '{"host":{"a":{"interface":"./a.effi"}}}',
      "host entry `a` needs a string `module`",
    ],
  ];
  assertEquals(
    cases.map((row) => shapeError(row[0])),
    cases.map((row) => invalidShape(row[1])),
  );
});

Deno.test("a malformed effektive.json gives the parser message", () => {
  const result = parseConfig("{ not json");
  assert(!result.ok);
  assert(result.error.tag === "malformed-json");
  assertEquals(result.error.path, "effektive.json");
  assertEquals(
    result.error.message,
    "Expected property name or '}' in JSON at position 2 (line 1 column 3)",
  );
});

Deno.test("each effektive.json diagnostic gives its exact message and span", () => {
  const cases: readonly (readonly [string, string, number, number])[] = [
    [
      '{"host":{"a":{"interface":"../a.effi","module":"./x.ts"}}}',
      "the interface of host entry `a` must be a path inside the project root that ends in .effi",
      14,
      25,
    ],
    [
      '{"host":{"a":{"interface":"./a.effi","module":"../x.ts"}}}',
      "the module of host entry `a` must be a path inside the project root",
      37,
      45,
    ],
    [
      '{"imports":[{"from":"a","allow":[],"zz":1}]}',
      "unknown key `zz` in imports entry 1",
      35,
      39,
    ],
    [
      '{"host":{"a":{"interface":"./a.effi","module":"./x.ts","zz":1}}}',
      "unknown key `zz` in host entry `a`",
      55,
      59,
    ],
    ['{"zz":1}', "unknown key `zz` in effektive.json", 1, 5],
  ];
  const found = cases.map((row) => {
    const result = parseConfig(row[0]);
    assert(result.ok, row[0]);
    return result.value.diagnostics.map((d) => [
      d.code,
      d.message,
      d.span.start,
      d.span.end,
    ]);
  });
  assertEquals(
    found,
    cases.map((row) => [["module/001", row[1], row[2], row[3]]]),
  );
});

function loadMessages(
  host: SourceHost,
  entries: readonly string[],
): readonly string[] {
  const result = loadProject(host, "", entries, undefined);
  assert(result.ok, JSON.stringify(result));
  return result.value.diagnostics.map((d) =>
    `${d.span.source}:${d.span.start}-${d.span.end} ${d.code} ${d.message}`
  );
}

Deno.test("each loader failure gives its exact message, in order", () => {
  const host = memoryHost({
    "effektive.json":
      '{"host":{"known":{"interface":"./k.effi","module":"./k.ts"},"h":{"interface":"./m.effi","module":"./m.ts"}},"imports":[{"from":"main","allow":["ok"]}]}',
    "dir/main.eff": [
      'import { a } from "./lib"',
      'import { b } from "pkg"',
      'import { c } from "../../up.eff"',
      'import { d } from "./gone.eff"',
      'import { e } from "host:nothing"',
      'import { f } from "host:known"',
      "",
    ].join("\n"),
    "main.eff":
      'import { x } from "./m.eff"\nimport { y } from "host:h"\nimport { z } from "./ok.eff"\nimport { w } from "./a#b.eff"\n',
    "m.eff": "export const x = (): int => 1\n",
    "m.effi": "",
    "ok.eff": "",
    "a#b.eff": "",
  });
  assertEquals(
    loadMessages(host, [
      "dir/main.eff",
      "main.eff",
      "gone.eff",
      "../x.eff",
      "notes.txt",
      "a#b.eff",
    ]),
    [
      "../x.eff:0-0 module/001 the entry path `../x.eff` is not a path inside the project root",
      "a#b.eff:0-0 module/001 the module path a#b.eff may contain only letters, digits, and _ . - /",
      "dir/main.eff:18-25 module/001 relative import `./lib` must end in .eff",
      "dir/main.eff:44-49 module/001 import `pkg` must start with ./ or ../, or use the host: prefix",
      "dir/main.eff:68-82 module/001 import `../../up.eff` leaves the project root",
      "dir/main.eff:101-113 module/002 cannot load dir/gone.eff: the file does not exist",
      "dir/main.eff:132-146 module/002 host module `nothing` is not registered in effektive.json",
      "dir/main.eff:165-177 module/002 cannot load k.effi: the file does not exist",
      "gone.eff:0-0 module/002 cannot load gone.eff: the file does not exist",
      "main.eff:18-27 module/005 module `main` cannot import `m` under the project import rules",
      "main.eff:46-54 module/001 m.effi and m.eff have the same module name",
      "main.eff:102-113 module/001 the module path a#b.eff may contain only letters, digits, and _ . - /",
      "notes.txt:0-0 module/001 the entry path `notes.txt` does not end in .eff or .effi",
    ],
  );
});

Deno.test("an unreadable file gives the host message", () => {
  const host: SourceHost = {
    readText: (path) =>
      path === "effektive.json" ? { ok: true, value: "{}" } : {
        ok: false,
        error: { tag: "unreadable", path: path, message: "boom" },
      },
  };
  assertEquals(loadMessages(host, ["a.eff"]), [
    "a.eff:0-0 module/002 cannot load a.eff: the file cannot be read: boom",
  ]);
});

Deno.test("a file that fails twice reports the same failure at each import", () => {
  const host = memoryHost({
    "effektive.json": "{}",
    "a.eff": 'import { x } from "./gone.eff"\nimport { y } from "./gone.eff"\n',
  });
  assertEquals(loadMessages(host, ["a.eff"]), [
    "a.eff:18-30 module/002 cannot load gone.eff: the file does not exist",
    "a.eff:49-61 module/002 cannot load gone.eff: the file does not exist",
  ]);
});
