// Tests for the related locations of the contract diagnostics
// `failure-contract/001` and `requirement-contract/001`. Each location is a
// node of the same body that introduces a missing entry.

import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lineStarts,
  memoryHost,
  positionOf,
} from "../src/core/frontend.ts";
import { diagnosticsOfCase, listErrorCases } from "./helpers.ts";

interface Located {
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

interface Reported {
  readonly code: string;
  readonly related: readonly Located[];
}

function report(
  files: Readonly<Record<string, string>>,
  entries: readonly string[] = ["m.eff"],
): Reported[] {
  const all: Record<string, string> = { "effektive.json": "{}", ...files };
  const result = checkProject(memoryHost(all), "", entries);
  assert(result.ok, JSON.stringify(result));
  return result.value.diagnostics.map((d) => ({
    code: d.code,
    related: (d.related ?? []).map((r) => {
      const text = all[r.span.source];
      const at = positionOf(lineStarts(text), text, r.span.start);
      return { line: at.line, column: at.column, message: r.message };
    }),
  }));
}

// The prelude holds 14 lines.
const PRELUDE = `type Int = int
type Text = string
error StoreDown = { code: Int }
error BookMissing = { id: Text }
error Boom = { id: Text }
service Shelf {
  find(id: Text): Option<Text> fails StoreDown
  save(value: Text): Text fails StoreDown
  count(): Int
}
service Store {
  get(): Text fails StoreDown
  put(value: Text): Text fails StoreDown
}
`;

function one(text: string): Reported[] {
  return report({ "m.eff": PRELUDE + text });
}

Deno.test("M1: a fail call is the location of its error", () => {
  assertEquals(
    one(`const lookup = (id: Text): Text fails StoreDown with Shelf.find =>
  Shelf.find(id) ?? fail(BookMissing({ id }))
`),
    [{
      code: "failure-contract/001",
      related: [{
        line: 16,
        column: 21,
        message: "can fail with `BookMissing` here",
      }],
    }],
  );
});

Deno.test("M2: two fail calls in two branches give two locations in source order", () => {
  assertEquals(
    one(`const direct = (n: Int): Int fails StoreDown =>
  if (n === 0) {
    fail(BookMissing({ id: "a" }))
  } else if (n === 1) {
    fail(BookMissing({ id: "b" }))
  } else {
    n
  }
`),
    [{
      code: "failure-contract/001",
      related: [
        { line: 17, column: 5, message: "can fail with `BookMissing` here" },
        { line: 19, column: 5, message: "can fail with `BookMissing` here" },
      ],
    }],
  );
});

Deno.test("M3: a fail in a handler is a location, the protected block is not", () => {
  assertEquals(
    one(
      `const risky = (): Int fails BookMissing => fail(BookMissing({ id: "x" }))
const m3 = (): Int fails StoreDown =>
  try {
    risky()
  } catch {
    BookMissing(e) => fail(BookMissing({ id: e.id }))
  }
`,
    ),
    [{
      code: "failure-contract/001",
      related: [
        { line: 20, column: 23, message: "can fail with `BookMissing` here" },
      ],
    }],
  );
});

Deno.test("M4: a handled error gives no location, an unhandled error does", () => {
  assertEquals(
    one(
      `const risky = (n: Int): Int fails BookMissing | Boom => fail(Boom({ id: "x" }))
const m4 = (n: Int): Int fails StoreDown =>
  {
    const a = try { risky(n) } catch { BookMissing(e) => 0 }
    a
  }
`,
    ),
    [{
      code: "failure-contract/001",
      related: [
        { line: 18, column: 21, message: "can fail with `Boom` here" },
      ],
    }],
  );
});

Deno.test("M5: a call of a local function is the location", () => {
  assertEquals(
    one(
      `const raise = (): Int fails BookMissing => fail(BookMissing({ id: "x" }))
const m5 = (): Int fails StoreDown => {
  const a = 1
  raise()
}
`,
    ),
    [{
      code: "failure-contract/001",
      related: [
        { line: 18, column: 3, message: "can fail with `BookMissing` here" },
      ],
    }],
  );
});

Deno.test("M6: a call of an imported function is the location", () => {
  assertEquals(
    report({
      "lib.eff": `export type Int = int
export error Gone = { code: Int }
export const risky = (n: Int): Int fails Gone => fail(Gone({ code: n }))
`,
      "m.eff": `import { Int, risky } from "./lib.eff"
error Local = { code: Int }
const m6 = (): Int fails Local => {
  const a = 1
  risky(a)
}
`,
    }),
    [{
      code: "failure-contract/001",
      related: [
        { line: 5, column: 3, message: "can fail with `Gone` here" },
      ],
    }],
  );
});

Deno.test("M7: a recursive group gives the call that carries the error", () => {
  assertEquals(
    one(`error Other = { code: Int }
const a = (n: Int): Int fails Other => if (n === 0) { 0 } else { b(n - 1) }
const b = (n: Int): Int => if (n === 0) { fail(Boom({ id: "" })) } else { a(n - 1) }
`),
    [{
      code: "failure-contract/001",
      related: [
        { line: 16, column: 66, message: "can fail with `Boom` here" },
      ],
    }],
  );
});

Deno.test("M8: a pipeline gives the left value and the stage their own errors", () => {
  assertEquals(
    one(
      `const left = (): Int fails BookMissing => fail(BookMissing({ id: "x" }))
const stage = (n: Int): Int fails Boom => fail(Boom({ id: "y" }))
const m8 = (): Int fails StoreDown =>
  left() |> stage()
`,
    ),
    [{
      code: "failure-contract/001",
      related: [
        { line: 18, column: 3, message: "can fail with `BookMissing` here" },
        { line: 18, column: 13, message: "can fail with `Boom` here" },
      ],
    }],
  );
});

Deno.test("M9: a fail in a callback of map is the location", () => {
  assertEquals(
    one(`const m9 = (xs: Int[]): Int[] fails StoreDown =>
  map(xs, (x) => fail(BookMissing({ id: "z" })))
`),
    [{
      code: "failure-contract/001",
      related: [
        { line: 16, column: 18, message: "can fail with `BookMissing` here" },
      ],
    }],
  );
});

Deno.test("M10: a method call is the location of a missing requirement", () => {
  assertEquals(
    one(
      `const m10 = (id: Text): Option<Text> fails StoreDown with Shelf.count => {
  const a = 1
  Shelf.find(id)
}
`,
    ),
    [{
      code: "requirement-contract/001",
      related: [
        { line: 17, column: 3, message: "requires `Shelf.find` here" },
      ],
    }],
  );
});

Deno.test("M11: a call under provide is not a location, a call outside it is", () => {
  const files = {
    "effektive.json": JSON.stringify({
      host: {
        providers: { interface: "./host/providers.effi", module: "./live.ts" },
      },
    }),
    "svc.eff": `export error Down = { m: string }
export service Db {
  read(): Int fails Down
  write(n: Int): void
}
export type Int = int
`,
    "host/providers.effi": `import { Db, Down } from "../svc.eff"
export provider DbLive provides Db fails Down
`,
    "main.eff": `import { Db, Down, Int } from "./svc.eff"
import { DbLive } from "host:providers"
export const bad = (): Int fails Down with Db.write => {
  const inside = provide(DbLive, () => Db.read())
  Db.read()
}
`,
  };
  const result = checkProject(memoryHost(files), "", ["main.eff"]);
  assert(result.ok, JSON.stringify(result));
  const text = files["main.eff"];
  assertEquals(
    result.value.diagnostics.map((d) => ({
      code: d.code,
      related: (d.related ?? []).map((r) => {
        const at = positionOf(lineStarts(text), text, r.span.start);
        return { line: at.line, column: at.column, message: r.message };
      }),
    })),
    [{
      code: "requirement-contract/001",
      related: [
        { line: 5, column: 3, message: "requires `Db.read` here" },
      ],
    }],
  );
});

Deno.test("M12: an inline arrow with a written clause reports inside its own body", () => {
  assertEquals(
    one(`const m12 = (): Int => {
  const inner = (x: Int): Int fails StoreDown => {
    const y = 1
    fail(BookMissing({ id: "q" }))
  }
  0
}
`),
    [{
      code: "failure-contract/001",
      related: [
        { line: 18, column: 5, message: "can fail with `BookMissing` here" },
      ],
    }],
  );
});

Deno.test("M13: a checked parameter is the location of the SchemaError form", () => {
  assertEquals(
    report({
      "m.eff": `type Text = string
error Other = {}
const consume = (value: Text): Text => value
export const entry = (first, input): Text fails Other => consume(input.name)
`,
    }),
    [{
      code: "failure-contract/001",
      related: [{
        line: 4,
        column: 30,
        message:
          "this input is checked, so the function can fail with `SchemaError`",
      }],
    }],
  );
});

Deno.test("M14: a fail in the use part of a using block is the location", () => {
  assertEquals(
    one(`const m14 = (): Int fails StoreDown =>
  using (job = ({ read: () => 1, close: () => {} })) { fail(BookMissing({ id: "u" })) } finally { job.close() }
`),
    [{
      code: "failure-contract/001",
      related: [
        { line: 16, column: 56, message: "can fail with `BookMissing` here" },
      ],
    }],
  );
});

Deno.test("M15: a call of a block-local function is the location, its declaration is not", () => {
  assertEquals(
    one(`const m15 = (): Int fails StoreDown => {
  const f = (x: Int): Int => fail(BookMissing({ id: "p" }))
  f(1)
}
`),
    [{
      code: "failure-contract/001",
      related: [
        { line: 17, column: 3, message: "can fail with `BookMissing` here" },
      ],
    }],
  );
});

Deno.test("M16: a nested call gives only the inner call", () => {
  assertEquals(
    one(`const m16 = (): Text fails Boom => Store.put(Store.get())
`),
    [{
      code: "failure-contract/001",
      related: [
        { line: 15, column: 46, message: "can fail with `StoreDown` here" },
      ],
    }],
  );
});

Deno.test("census: each contract diagnostic of the error fixtures has a location for each missing entry", () => {
  let census = 0;
  for (const c of listErrorCases()) {
    if (c.kind === "file" && c.name.startsWith("syntax-")) continue;
    for (const d of diagnosticsOfCase(c)) {
      if (
        (d.code !== "failure-contract/001" &&
          d.code !== "requirement-contract/001") ||
        !d.message.startsWith("the body ")
      ) continue;
      census++;
      const verb = d.code === "failure-contract/001"
        ? "can fail with "
        : "requires ";
      const list = d.message.slice(
        d.message.indexOf(verb) + verb.length,
        d.message.indexOf(", which"),
      );
      const related = d.related ?? [];
      for (const name of list.split(", ")) {
        assert(
          related.some((r) => r.message === `${verb}\`${name}\` here`),
          `${c.path}: no location for ${name}`,
        );
      }
      for (const r of related) {
        assert(
          r.span.start >= d.span.start && r.span.end <= d.span.end,
          `${c.path}: a location lies outside the diagnostic span`,
        );
      }
    }
  }
  assert(census >= 3, `census found ${census} diagnostics`);
});
