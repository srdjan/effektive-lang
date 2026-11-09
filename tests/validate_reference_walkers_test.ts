// The reference walkers of the validator (src/core/validate/expr.ts). Two
// checks follow a binding through a closure body and report each use that the
// rules forbid: a borrowed handle (`using` over an opaque type) and a
// self reference in a recursive Schema body (`schemaRecursive`). A missed child expression
// hides a use, so each test puts a reference at many places of a body and
// pins which uses the validator reports. A use is named by the start offset
// of its span.

import { assert, assertEquals } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR, Parameter } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";

type Obj = Record<string, unknown>;

function copy<T>(value: T): T {
  return structuredClone(value);
}

function lower(files: Record<string, string>, entry: string) {
  const checked = checkProject(memoryHost(files), "", [entry]);
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics.map((d) => d.code), []);
  const result = lowerProject(checked.value).get(entry.replace(/\.eff$/, ""));
  assert(result?.ok === true);
  const sources = new Map(
    Object.entries(files).filter(([name]) => !name.endsWith(".json")),
  );
  assertEquals(validateModule(result.value, sources), []);
  return { ir: result.value, sources };
}

/** An expression of `kind` that takes its annotation from `like`. */
function make(like: Expr, kind: string, fields: Obj): Expr {
  const { type, execution, effects, span } = like;
  const node: unknown = { type, execution, effects, span, kind, ...fields };
  return node as Expr;
}

/** A reference to `target` whose span starts at `start`. */
function reference(like: Expr, target: string, start: number): Expr {
  return make(like, "reference", {
    target,
    span: { source: like.span.source, start, end: start + 1 },
  });
}

const PARAMETER: Parameter = {
  id: "local:m#p",
  name: "p",
  type: { kind: "primitive", name: "int" },
  span: { source: "m.eff", start: 0, end: 0 },
};

/** The places for a reference in a body: one builder for each wrapper shape. */
type Wrapper = (like: Expr, r: readonly Expr[]) => Expr;

const WRAPPERS: Readonly<Record<string, Wrapper>> = {
  alone: (_, [r]) => r,
  tuple: (l, [r]) => make(l, "tuple", { elements: [l, r] }),
  array: (l, [r]) => make(l, "array", { elements: [r] }),
  record: (l, [r]) => make(l, "record", { fields: [{ name: "f", value: r }] }),
  update: (l, [r]) =>
    make(l, "update", { record: l, fields: [{ name: "f", value: r }] }),
  get: (l, [r]) => make(l, "get", { record: r, field: "f" }),
  "if-condition": (l, [r]) => make(l, "if", { condition: r, then: l, else: l }),
  "if-then": (l, [r]) => make(l, "if", { condition: l, then: r, else: l }),
  "if-else": (l, [r]) => make(l, "if", { condition: l, then: l, else: r }),
  "match-subject": (l, [r]) => make(l, "match", { subject: r, arms: [] }),
  "match-arm": (l, [r]) =>
    make(l, "match", {
      subject: l,
      arms: [{ pattern: { kind: "wildcard", span: l.span }, body: r }],
    }),
  "block-bind": (l, [r]) =>
    make(l, "block", {
      steps: [{ kind: "bind", binding: PARAMETER, value: r }],
      result: l,
    }),
  "block-evaluate": (l, [r]) =>
    make(l, "block", { steps: [{ kind: "evaluate", value: r }], result: l }),
  "block-result": (l, [r]) => make(l, "block", { steps: [], result: r }),
  closure: (l, [r]) => make(l, "closure", { parameters: [PARAMETER], body: r }),
  "catch-body": (l, [r]) => make(l, "catch", { body: r, handlers: [] }),
  "catch-handler": (l, [r]) =>
    make(l, "catch", {
      body: l,
      handlers: [{
        error: "error:m#Stop",
        binding: PARAMETER,
        body: r,
        span: l.span,
      }],
    }),
  "call-callee": (l, [r]) => make(l, "call", { callee: r, arguments: [] }),
  "call-argument": (l, [r]) =>
    make(l, "call", { callee: l, arguments: [l, r] }),
  binary: (l, [r]) => make(l, "binary", { operator: "+", left: l, right: r }),
  fail: (l, [r]) => make(l, "fail", { error: r }),
  "map-stream": (l, [r]) => make(l, "map-stream", { stream: r, transform: l }),
  "run-stream": (l, [r]) => make(l, "run-stream", { stream: r, sink: l }),
  "perform-first": (l, [r]) =>
    make(l, "perform", { capability: "cap:m#S.m", arguments: [r] }),
};

/** The starts of the spans that the validator reports with `message`. */
function reported(
  ir: ModuleIR,
  sources: ReadonlyMap<string, string>,
  message: string,
): number[] {
  return validateModule(ir, sources)
    .filter((d) => d.message.includes(message))
    .map((d) => d.span.start)
    .sort((a, b) => a - b);
}

/**
 * Puts each body from `bodies` in place with `install`, and returns the starts
 * of the reported uses for each label. Each body gets fresh references that
 * start at 1000, 1001, and so on.
 */
function probe(
  base: { ir: ModuleIR; sources: ReadonlyMap<string, string> },
  message: string,
  like: Expr,
  target: string,
  install: (ir: ModuleIR, body: Expr) => void,
  bodies: Readonly<Record<string, (r: readonly Expr[], l: Expr) => Expr>>,
): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const [label, build] of Object.entries(bodies)) {
    const ir = copy(base.ir);
    const refs = [0, 1, 2].map((i) => reference(like, target, 1000 + i));
    install(ir, build(refs, make(like, "literal", { value: 1 })));
    found[label] = reported(ir, base.sources, message);
  }
  return found;
}

/** The bodies that wrap one reference in each shape, plus the bodies of `extra`. */
function bodiesWith(
  extra: Readonly<Record<string, (r: readonly Expr[], l: Expr) => Expr>>,
): Record<string, (r: readonly Expr[], l: Expr) => Expr> {
  const bodies: Record<string, (r: readonly Expr[], l: Expr) => Expr> = {};
  for (const [label, wrap] of Object.entries(WRAPPERS)) {
    bodies[label] = (r, l) => wrap(l, r);
  }
  return { ...bodies, ...extra };
}

// ------------------------------------------------------------------ borrowed handle

/** The starts of the reported uses of the handle, for each body. */
const EXPECTED_BORROWED: Record<string, number[]> = {
  "alone": [1000],
  "tuple": [1000],
  "array": [1000],
  "record": [1000],
  "update": [1000],
  "get": [1000],
  "if-condition": [1000],
  "if-then": [1000],
  "if-else": [1000],
  "match-subject": [1000],
  "match-arm": [1000],
  "block-bind": [1000],
  "block-evaluate": [1000],
  "block-result": [1000],
  "closure": [1000],
  "catch-body": [1000],
  "catch-handler": [1000],
  "call-callee": [1000],
  "call-argument": [1000],
  "binary": [1000],
  "fail": [1000],
  "map-stream": [1000],
  "run-stream": [1000],
  "perform-first": [1000],
  "borrowed call": [],
  "borrowed perform": [],
  "call at index 1": [1000],
  "perform at index 1": [1000],
  "call of a literal": [1000],
  "borrowed call in tuple": [],
  "borrowed call in block evaluate": [],
  "borrowed call in closure": [1000],
  "borrowed call in match arm": [],
  "two borrowed calls": [],
  "borrowed and bare": [1001],
  "handle as the callee": [1000],
};

Deno.test("borrowed handle references: only a borrowed argument may use the handle", () => {
  const files = {
    "effektive.json": JSON.stringify({
      host: { files: { interface: "./host.effi", module: "./host.ts" } },
    }),
    "host.effi": `
export opaque type Handle
export type Text = string
export service Files {
  open(): Handle
  read(borrow handle: Handle): Text
  close(borrow handle: Handle): void
}
`,
    "main.eff": `
import { Handle, Text, Files } from "host:files"
const readBorrowed = (borrow handle: Handle): Text with Files.read => Files.read(handle)
export const load = (): Text with Files.open | Files.read | Files.close =>
  using (handle = Files.open()) { readBorrowed(handle) } finally { Files.close(handle) }
`,
  };
  const base = lower(files, "main.eff");
  const load = base.ir.declarations.find((d) => d.name === "load");
  assert(load?.kind === "function" && load.body.kind === "with-resource");
  const [use, release] = [load.body.use, load.body.release];
  assert(
    use.kind === "closure" && use.body.kind === "block" &&
      use.body.result.kind === "call",
  );
  assert(
    release.kind === "closure" && release.body.kind === "block" &&
      release.body.result.kind === "perform",
  );
  const call = use.body.result;
  const perform = release.body.result;
  const index = base.ir.declarations.indexOf(load);
  const found = probe(
    base,
    "borrowed handle may only pass to a borrow-qualified method",
    call,
    load.body.use.parameters[0].id,
    (ir, body) => {
      const declaration = ir.declarations[index];
      assert(declaration.kind === "function");
      assert(declaration.body.kind === "with-resource");
      assert(declaration.body.use.kind === "closure");
      (declaration.body.use as { body: Expr }).body = body;
    },
    bodiesWith({
      "borrowed call": ([r]) => ({ ...call, arguments: [r] }) as Expr,
      "borrowed perform": ([r]) => ({ ...perform, arguments: [r] }) as Expr,
      "call at index 1": ([r], l) => ({ ...call, arguments: [l, r] }) as Expr,
      "perform at index 1": ([r], l) =>
        ({ ...perform, arguments: [l, r] }) as Expr,
      "call of a literal": ([r], l) =>
        ({ ...call, callee: l, arguments: [r] }) as Expr,
      "borrowed call in tuple": ([r], l) =>
        make(l, "tuple", { elements: [{ ...call, arguments: [r] } as Expr] }),
      "borrowed call in block evaluate": ([r], l) =>
        make(l, "block", {
          steps: [{ kind: "evaluate", value: { ...call, arguments: [r] } }],
          result: l,
        }),
      "borrowed call in closure": ([r], l) =>
        make(l, "closure", {
          parameters: [],
          body: { ...call, arguments: [r] },
        }),
      "borrowed call in match arm": ([r], l) =>
        make(l, "match", {
          subject: l,
          arms: [{
            pattern: { kind: "wildcard", span: l.span },
            body: { ...call, arguments: [r] },
          }],
        }),
      "two borrowed calls": ([r, s], l) =>
        make(l, "tuple", {
          elements: [
            { ...call, arguments: [r] } as Expr,
            { ...perform, arguments: [s] } as Expr,
          ],
        }),
      "borrowed and bare": ([r, s], l) =>
        make(l, "tuple", {
          elements: [{ ...call, arguments: [r] } as Expr, s],
        }),
      "handle as the callee": ([r], l) =>
        ({ ...call, callee: r, arguments: [l] }) as Expr,
    }),
  );
  assertEquals(found, EXPECTED_BORROWED);
});

// ------------------------------------------------------------------ recursive Schema

/** The start of the reported recursion error, or none, for each body. */
const EXPECTED_SCHEMA: Record<string, number[]> = {
  "optional-key": [],
  "array": [],
  "null-to-missing-key": [],
  "default of array": [],
  "default of bare": [1647],
  "default callback with self": [1647],
  "default with one argument": [1647],
  "optional-transform guarded": [],
  "optional-transform self in callback": [1647],
  "tuple of array": [],
  "record of array": [],
  "array of closure": [1647],
  "array of call": [1647],
  "array of get": [1647],
  "array of unrelated call": [1647],
  "unrelated reference": [1647],
  "beside alone": [1647],
  "unrelated beside alone": [],
  "beside tuple": [1647],
  "unrelated beside tuple": [],
  "beside array": [1647],
  "unrelated beside array": [],
  "beside record": [1647],
  "unrelated beside record": [],
  "beside update": [1647],
  "unrelated beside update": [],
  "beside get": [1647],
  "unrelated beside get": [],
  "beside if-condition": [1647],
  "unrelated beside if-condition": [],
  "beside if-then": [1647],
  "unrelated beside if-then": [],
  "beside if-else": [1647],
  "unrelated beside if-else": [],
  "beside match-subject": [1647],
  "unrelated beside match-subject": [],
  "beside match-arm": [1647],
  "unrelated beside match-arm": [],
  "beside block-bind": [1647],
  "unrelated beside block-bind": [],
  "beside block-evaluate": [1647],
  "unrelated beside block-evaluate": [],
  "beside block-result": [1647],
  "unrelated beside block-result": [],
  "beside closure": [1647],
  "unrelated beside closure": [],
  "beside catch-body": [1647],
  "unrelated beside catch-body": [],
  "beside catch-handler": [1647],
  "unrelated beside catch-handler": [],
  "beside call-callee": [1647],
  "unrelated beside call-callee": [],
  "beside call-argument": [1647],
  "unrelated beside call-argument": [],
  "beside binary": [1647],
  "unrelated beside binary": [],
  "beside fail": [1647],
  "unrelated beside fail": [],
  "beside map-stream": [1647],
  "unrelated beside map-stream": [],
  "beside run-stream": [1647],
  "unrelated beside run-stream": [],
  "beside perform-first": [1647],
  "unrelated beside perform-first": [],
};

Deno.test("recursive Schema guard: a self reference must sit in a guarded position", () => {
  const text = Deno.readTextFileSync(
    new URL("../fixtures/emit/schema-recursive-wire.eff", import.meta.url),
  );
  const base = lower({ "effektive.json": "{}", "m.eff": text }, "m.eff");
  const node = base.ir.declarations.find((d) => d.name === "node");
  assert(node?.kind === "constant" && node.value.kind === "schema");
  const callback = node.value.arguments[0];
  assert(callback.kind === "closure" && callback.body.kind === "schema");
  const record = callback.body.arguments[0];
  assert(record.kind === "record");
  const next = record.fields[1].value;
  assert(next.kind === "schema" && next.op === "optional-key");
  const self = callback.parameters[0].id;
  const index = base.ir.declarations.indexOf(node);
  const array = (r: Expr, l: Expr) =>
    make(l, "schema", { op: "array", arguments: [r] });
  const beside = (a: Expr, b: Expr, l: Expr) =>
    make(l, "record", {
      fields: [{ name: "a", value: a }, { name: "b", value: b }],
    });
  const bodies: Record<string, (r: readonly Expr[], l: Expr) => Expr> = {
    "optional-key": ([r], l) =>
      make(l, "schema", { op: "optional-key", arguments: [r] }),
    array: ([r], l) => array(r, l),
    "null-to-missing-key": ([r], l) =>
      make(l, "schema", { op: "null-to-missing-key", arguments: [r] }),
    "default of array": ([r], l) =>
      make(l, "schema", {
        op: "constructor-default",
        arguments: [array(r, l), l],
      }),
    "default of bare": ([r], l) =>
      make(l, "schema", { op: "constructor-default", arguments: [r, l] }),
    "default callback with self": ([r], l) =>
      make(l, "schema", {
        op: "constructor-default",
        arguments: [
          array(r, l),
          make(l, "closure", { parameters: [], body: r }),
        ],
      }),
    "default with one argument": ([r], l) =>
      make(l, "schema", { op: "constructor-default", arguments: [r] }),
    "optional-transform guarded": ([r], l) =>
      make(l, "schema", {
        op: "optional-transform",
        arguments: [array(r, l), l, l, l],
      }),
    "optional-transform self in callback": ([r], l) =>
      make(l, "schema", {
        op: "optional-transform",
        arguments: [l, l, r, l],
      }),
    "tuple of array": ([r], l) => make(l, "tuple", { elements: [array(r, l)] }),
    "record of array": ([r], l) =>
      make(l, "record", { fields: [{ name: "f", value: array(r, l) }] }),
    "array of closure": ([r], l) =>
      array(make(l, "closure", { parameters: [], body: r }), l),
    "array of call": ([r], l) =>
      array(make(l, "call", { callee: l, arguments: [r] }), l),
    "array of get": ([r], l) =>
      array(make(l, "get", { record: r, field: "f" }), l),
    "array of unrelated call": (_, l) =>
      array(make(l, "call", { callee: l, arguments: [l] }), l),
    "unrelated reference": (_, l) => reference(l, "local:m#other", 2000),
  };
  for (const [label, wrap] of Object.entries(WRAPPERS)) {
    bodies[`beside ${label}`] = ([r, t], l) =>
      beside(array(r, l), wrap(l, [t]), l);
    bodies[`unrelated beside ${label}`] = ([r], l) =>
      beside(
        array(r, l),
        wrap(l, [reference(l, "local:m#other", 2000)]),
        l,
      );
  }
  const found = probe(
    base,
    "schemaRecursive needs a pure body from self to the expected data Schema",
    next,
    self,
    (ir, body) => {
      const declaration = ir.declarations[index];
      assert(declaration.kind === "constant");
      assert(declaration.value.kind === "schema");
      const closure = declaration.value.arguments[0];
      assert(closure.kind === "closure" && closure.body.kind === "schema");
      const fields = closure.body.arguments[0];
      assert(fields.kind === "record");
      (fields.fields[1] as { value: Expr }).value = body;
    },
    bodies,
  );
  assertEquals(found, EXPECTED_SCHEMA);
});
