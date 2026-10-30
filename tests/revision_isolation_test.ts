import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  completionsAt,
  Program,
  type Revision,
  semanticClassifications,
  serializeModule,
  signatureHelpAt,
  type TypeReader,
} from "../src/core/frontend.ts";
import { TypeScriptOutputs } from "../src/core/typescript.ts";

type Files = Record<string, string>;

const original =
  "type N = int\ntype A = { n: N }\ntype B = { b: N }\ntype U = A | B\nexport const f = (x: N): A => ({ n: x })\n";
const changed = original.replace("n: N", "changed: N").replace(
  "n: x",
  "changed: x",
);

function update(
  program: Program,
  set: Files = {},
  remove: string[] = [],
): Revision {
  const result = program.update({ set, remove });
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

function fresh(files: Files): Revision {
  return update(new Program(), { "effektive.json": "{}", ...files });
}

function snapshot(revision: Revision, outputs = new TypeScriptOutputs()) {
  assertEquals(revision.diagnostics, []);
  return revision.moduleNames().map((name) => {
    const lowered = revision.lowered(name);
    assert(lowered?.ok, JSON.stringify(lowered));
    assertEquals(revision.validate(new Map([[name, lowered]])).get(name), []);
    const emitted = outputs.emitted(revision, name);
    assert(emitted?.ok, JSON.stringify(emitted));
    return {
      name,
      ir: serializeModule(lowered.value),
      text: emitted.value.text,
      spans: outputs.spanTable(revision, name),
      map: outputs.sourceMap(revision, name),
    };
  });
}

Deno.test("retained cold tagged-record IR validates after a definition edit", () => {
  const program = new Program();
  const first = update(program, {
    "effektive.json": "{}",
    "main.eff": original,
  });
  const second = update(program, { "main.eff": changed });
  assertEquals(second.diagnostics, []);
  assertEquals(program.counts.lowerings, 0);
  assertEquals(snapshot(first), snapshot(fresh({ "main.eff": original })));
  assertEquals(snapshot(second), snapshot(fresh({ "main.eff": changed })));
});

Deno.test("newer output can precede cold original output and interleaved queries", () => {
  const program = new Program();
  const outputs = new TypeScriptOutputs();
  const first = update(program, {
    "effektive.json": "{}",
    "main.eff": original,
  });
  const second = update(program, { "main.eff": changed });
  const thirdText = changed.replaceAll("changed", "third");
  const third = update(program, { "main.eff": thirdText });
  const expectedFirst = snapshot(fresh({ "main.eff": original }));
  const expectedSecond = snapshot(fresh({ "main.eff": changed }));
  const expectedThird = snapshot(fresh({ "main.eff": thirdText }));
  assertEquals(snapshot(third, outputs), expectedThird);
  assertEquals(snapshot(first, outputs), expectedFirst);
  assertEquals(snapshot(second, outputs), expectedSecond);
  assertEquals(snapshot(first, outputs), expectedFirst);
  assertEquals(snapshot(third, outputs), expectedThird);
});

Deno.test("warm original output retains cache objects after definition changes", () => {
  const program = new Program();
  const outputs = new TypeScriptOutputs();
  const first = update(program, {
    "effektive.json": "{}",
    "main.eff": original,
  });
  const expected = snapshot(first, outputs);
  const lowered = first.lowered("main");
  const emitted = outputs.emitted(first, "main");
  const spans = outputs.spanTable(first, "main");
  const map = outputs.sourceMap(first, "main");
  update(program, { "main.eff": changed });
  assertEquals(snapshot(first, outputs), expected);
  assert(first.lowered("main") === lowered);
  assert(outputs.emitted(first, "main") === emitted);
  assert(outputs.spanTable(first, "main") === spans);
  assert(outputs.sourceMap(first, "main") === map);
});

Deno.test("retained imports keep alias and tagged definitions after edits and removal", () => {
  const dependency =
    "export type N = int\nexport type A = { n: N }\ntype B = { b: N }\ntype U = A | B\n";
  const main =
    'import { N, A } from "./dep.eff"\nexport const f = (x: N): A => ({ n: x })\n';
  const files = { "dep.eff": dependency, "main.eff": main };
  const program = new Program();
  const first = update(program, { "effektive.json": "{}", ...files });
  const current = {
    "dep.eff": dependency.replace("int", "string").replace(
      "n: N",
      "changed: N",
    ),
    "main.eff": main.replace("n: x", "changed: x"),
  };
  const second = update(program, current);
  assertEquals(snapshot(second), snapshot(fresh(current)));
  assertEquals(snapshot(first), snapshot(fresh(files)));
  const removed = update(program, {}, ["dep.eff"]);
  assert(removed.diagnostics.length > 0);
  assertEquals(snapshot(first), snapshot(fresh(files)));
  const restored = update(program, files);
  assertEquals(snapshot(restored), snapshot(fresh(files)));
});

Deno.test("retained error fields and editor completions keep the original contract", () => {
  const text =
    "type N = int\nerror Stop = { code: N }\nconst raise = (): N fails Stop => fail(Stop({ code: 1 }))\nexport const run = (): N => try { raise() } catch { Stop(e) => e.code }\n";
  const program = new Program();
  const first = update(program, { "effektive.json": "{}", "main.eff": text });
  const expected = fresh({ "main.eff": text });
  const nextText = text.replaceAll("code", "detail");
  const second = update(program, { "main.eff": nextText });
  const ref = first.types.errorRecordOf("error:main#Stop");
  const expectedRef = expected.types.errorRecordOf("error:main#Stop");
  assert(ref !== undefined && expectedRef !== undefined);
  const node = first.types.node(ref);
  const expectedNode = expected.types.node(expectedRef);
  assert(node.kind === "record" && expectedNode.kind === "record");
  assertEquals(node.fields.map((field) => field.name), ["code"]);
  assertEquals(
    node.fields.map((field) => field.name),
    expectedNode.fields.map((field) => field.name),
  );
  const at = text.indexOf("e.code") + "e.co".length;
  const completions = completionsAt(first, "main.eff", at);
  assertEquals(completions.map((entry) => entry.label), ["code"]);
  assertEquals(completions, completionsAt(expected, "main.eff", at));
  assertEquals(snapshot(first), snapshot(expected));
  assertEquals(snapshot(second), snapshot(fresh({ "main.eff": nextText })));
});

function definitionState(table: TypeReader) {
  const body = table.aliasOf("type:main#Choice");
  const identity = table.identityBaseOf("type:main#Choice");
  const tagged = table.taggedRecordOf("type:main#Choice");
  return {
    body: body === undefined ? undefined : table.node(body).kind,
    identity: identity === undefined ? undefined : table.node(identity).kind,
    tagged: tagged === undefined ? undefined : table.node(tagged).kind,
    sealed: table.isSealed("type:main#Choice"),
    predicate: table.predicateOf("type:main#Choice"),
  };
}

Deno.test("retained definition kinds, sealing and predicates survive replacement and restoration", () => {
  const text = "export sealed type Choice = int where n => n > 0\n";
  const program = new Program();
  const first = update(program, { "effektive.json": "{}", "main.eff": text });
  const expected = fresh({ "main.eff": text });
  const state = definitionState(expected.types);
  assertEquals(state.identity, "primitive");
  assertEquals(state.sealed, true);
  assert(state.predicate !== undefined);
  for (
    const replacement of [
      "export type Choice = int where n => n > 10\n",
      "export type Choice = string\n",
      "type N = int\nexport type Choice = { value: N }\n",
      "type N = int\nexport type Choice = N\n",
      "type N = int\n",
      text,
    ]
  ) {
    const current = update(program, { "main.eff": replacement });
    assertEquals(definitionState(first.types), state);
    assertEquals(snapshot(first), snapshot(expected));
    assertEquals(
      snapshot(current),
      snapshot(fresh({ "main.eff": replacement })),
    );
  }
});

Deno.test("retained function aliases keep original signature help", () => {
  const text =
    "type N = int\ntype Handler = (value: N) => N\nexport const run = (handler: Handler): N => handler(1)\n";
  const program = new Program();
  const first = update(program, { "effektive.json": "{}", "main.eff": text });
  const expected = fresh({ "main.eff": text });
  const nextText = text.replace("(value: N)", "(left: N, right: N)").replace(
    "handler(1)",
    "handler(1, 2)",
  );
  const second = update(program, { "main.eff": nextText });
  const at = text.indexOf("handler(1)") + "handler(".length;
  const help = signatureHelpAt(first, "main.eff", at);
  assert(help !== undefined);
  assertEquals(help.parameters.length, 1);
  assertEquals(help, signatureHelpAt(expected, "main.eff", at));
  assertNotEquals(
    help,
    signatureHelpAt(
      second,
      "main.eff",
      nextText.indexOf("handler(1") + "handler(".length,
    ),
  );
  assertEquals(snapshot(first), snapshot(expected));
  assertEquals(snapshot(second), snapshot(fresh({ "main.eff": nextText })));
});

Deno.test("retained semantic classifications keep original tagged membership", () => {
  const text =
    "type N = int\nexport type Choice = { value: N }\ntype Other = { other: N }\ntype U = Choice | Other\nexport const pass = (value: Choice): Choice => value\n";
  const program = new Program();
  const first = update(program, { "effektive.json": "{}", "main.eff": text });
  const nextText = text.replace("{ value: N }", "N");
  const second = update(program, { "main.eff": nextText });
  const classes = semanticClassifications(first, "main.eff", text);
  assertEquals(
    classes.find((entry) => entry.span.start === text.lastIndexOf("Choice"))
      ?.type,
    "class",
  );
  assertEquals(
    classes,
    semanticClassifications(fresh({ "main.eff": text }), "main.eff", text),
  );
  assertEquals(
    semanticClassifications(second, "main.eff", nextText).find((entry) =>
      entry.span.start === nextText.lastIndexOf("Choice")
    )?.type,
    "type",
  );
  assertEquals(snapshot(first), snapshot(fresh({ "main.eff": text })));
});

Deno.test("failed configuration updates preserve retained results and recover changed files", () => {
  const program = new Program();
  const first = update(program, {
    "effektive.json": "{}",
    "main.eff": original,
  });
  const failed = program.update({
    set: { "effektive.json": "{", "main.eff": changed },
  });
  assert(!failed.ok);
  assertEquals(program.counts.checks, 1);
  assertEquals(snapshot(first), snapshot(fresh({ "main.eff": original })));
  const recovered = update(program, { "effektive.json": "{}" });
  assertEquals(recovered.number, 2);
  assertEquals(snapshot(recovered), snapshot(fresh({ "main.eff": changed })));
  assertEquals(snapshot(first), snapshot(fresh({ "main.eff": original })));
});

Deno.test("span-only edits preserve interface cutoffs and unrelated edits preserve object reuse", () => {
  const files = {
    "dep.eff": "export type N = int\nexport const value: N = 1\n",
    "main.eff":
      'import { N, value } from "./dep.eff"\nexport const copy: N = value\n',
    "other.eff": "type N = int\nexport const value: N = 1\n",
  };
  const program = new Program();
  const outputs = new TypeScriptOutputs();
  const first = update(program, { "effektive.json": "{}", ...files });
  const expected = snapshot(first, outputs);
  const firstLowering = first.lowered("main");
  const before = program.counts;
  files["dep.eff"] = "\n" + files["dep.eff"];
  const moved = update(program, { "dep.eff": files["dep.eff"] });
  assertEquals(moved.rechecked, ["dep"]);
  assertEquals(moved.interfaceHash("dep"), first.interfaceHash("dep"));
  assertEquals(program.counts, {
    parses: before.parses + 1,
    checks: before.checks + 1,
    lowerings: before.lowerings,
  });
  assert(moved.lowered("main") !== firstLowering);
  assertEquals(snapshot(moved, outputs), snapshot(fresh(files)));
  assertEquals(snapshot(first, outputs), expected);
  const checked = moved.checkedModule("main");
  const lowering = moved.lowered("main");
  const emitted = outputs.emitted(moved, "main");
  const counts = program.counts;
  const emits = outputs.counts;
  files["other.eff"] = files["other.eff"].replace("= 1", "= 2");
  const unrelated = update(program, { "other.eff": files["other.eff"] });
  assertEquals(unrelated.rechecked, ["other"]);
  assert(unrelated.checkedModule("main") === checked);
  assert(unrelated.lowered("main") === lowering);
  assert(outputs.emitted(unrelated, "main") === emitted);
  assertEquals(outputs.counts, emits);
  assertEquals(program.counts, {
    parses: counts.parses + 1,
    checks: counts.checks + 1,
    lowerings: counts.lowerings,
  });
  assertEquals(snapshot(unrelated, outputs), snapshot(fresh(files)));
});

Deno.test("retained finalizers can lazily intern function types after a later update", () => {
  const text =
    "type N = int\nservice Jobs { close(): void }\nexport const run = (value: N): N uses Jobs.close => try { value } finally { Jobs.close() }\n";
  const program = new Program();
  const first = update(program, { "effektive.json": "{}", "main.eff": text });
  const nextText = text.replace("type N = int", "type N = string");
  const second = update(program, { "main.eff": nextText });
  assertEquals(program.counts.lowerings, 0);
  const before = first.types.size;
  assertEquals(snapshot(first), snapshot(fresh({ "main.eff": text })));
  assert(first.types.size > before);
  assertEquals(first.types.size, second.types.size);
  assertEquals(snapshot(second), snapshot(fresh({ "main.eff": nextText })));
});

Deno.test("rotating independent modules retain at most one table per cached module plus the current table", () => {
  const files: Files = { "effektive.json": "{}" };
  const names = ["a", "b", "c", "d", "e"];
  for (const name of names) {
    files[`${name}.eff`] = "type N = int\nexport const value: N = 0\n";
  }
  const program = new Program();
  let current = update(program, files);
  for (let sweep = 1; sweep <= 4; sweep++) {
    for (const name of names) {
      const unchanged = names.find((other) => other !== name)!;
      const checked = current.checkedModule(unchanged);
      const previousTable = current.types;
      files[`${name}.eff`] = `type N = int\nexport const value: N = ${sweep}\n`;
      current = update(program, { [`${name}.eff`]: files[`${name}.eff`] });
      assert(current.types !== previousTable);
      assert(current.checkedModule(unchanged) === checked);
      assertEquals(current.rechecked, [name]);
      const tables = new Set<TypeReader>([current.types]);
      for (const module of current.moduleNames()) {
        const checkedModule = current.checkedModule(module);
        assert(checkedModule !== undefined);
        tables.add(checkedModule.declarations.env.table);
      }
      assert(tables.size <= names.length + 1);
    }
    const checked = names.map((name) => current.checkedModule(name));
    const lastCheckTables = new Set<TypeReader>(
      checked.map((module) => {
        assert(module !== undefined);
        return module.declarations.env.table;
      }),
    );
    assertEquals(lastCheckTables.size, names.length);
    assert(lastCheckTables.has(current.types));
    current = update(program);
    assertEquals(current.rechecked, []);
    assert(
      names.every((name, index) =>
        current.checkedModule(name) === checked[index]
      ),
    );
    assert(!lastCheckTables.has(current.types));
    assertEquals(snapshot(current), snapshot(fresh(files)));
  }
});
