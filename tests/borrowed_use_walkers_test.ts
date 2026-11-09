// Tests for the two checks of a borrowed local in src/core/check_expr.ts: a
// scoped operation record (`using` over a record) and a borrowed host
// handle (`using` over an opaque type or a `borrow` parameter). Each row
// gives a program and the number of reports of the check's message. Every test runs through the public entry `checkProject`.

import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/frontend.ts";

const RECORD =
  "a scoped operation record may only be used as the direct receiver of an operation call";
const HANDLE = "a borrowed handle may only pass to a borrow-qualified method";

interface Row {
  readonly name: string;
  readonly body: string;
  readonly reports: number;
}

function reportsOf(
  files: Record<string, string>,
  entry: string,
  message: string,
): number {
  const result = checkProject(memoryHost(files), "", [entry]);
  assert(result.ok, JSON.stringify(result));
  return result.value.diagnostics.filter((d) => d.message === message).length;
}

function single(text: string): Record<string, string> {
  return { "effektive.json": "{}", "m.eff": text };
}

// ------------------------------------------------------------------ scoped record

const RECORD_ROWS: readonly Row[] = [
  { name: "call an operation", body: "file.read()", reports: 0 },
  {
    name: "call two operations",
    body: "file.read(); file.read()",
    reports: 0,
  },
  { name: "return the record", body: "file", reports: 1 },
  { name: "read a field without a call", body: "file.read", reports: 1 },
  {
    name: "copy the record",
    body: "const copy = file; copy.read()",
    reports: 1,
  },
  {
    name: "call inside an arrow",
    body: "const later = () => file.read(); later()",
    reports: 1,
  },
  {
    name: "field of a field",
    body: "const saved = { saved: file }; saved",
    reports: 1,
  },
  {
    name: "one good use and one bad use",
    body: "file.read(); file",
    reports: 1,
  },
];

for (const row of RECORD_ROWS) {
  Deno.test(`scoped operation record: ${row.name}`, () => {
    const text = `
type Text = string
service Files { open(): { read: () => Text, close: () => void } }
const probe = () => using (file = Files.open()) { ${row.body} } finally { file.close() }
`;
    assertEquals(reportsOf(single(text), "m.eff", RECORD), row.reports);
  });
}

// ------------------------------------------------------------------ borrowed handle

function handleProject(main: string): Record<string, string> {
  return {
    "effektive.json": JSON.stringify({
      host: { files: { interface: "./host.effi", module: "./host.ts" } },
    }),
    "host.effi": `
export opaque type Handle
export type Text = string
export service Files {
  open(): Handle
  read(borrow handle: Handle): Text
  plain(handle: Handle): Text
  both(borrow first: Handle, borrow second: Handle): Text
  second(first: Handle, borrow second: Handle): Text
  close(borrow handle: Handle): void
}
`,
    "main.eff": `
import { Handle, Text, Files } from "host:files"
const borrowed = (borrow handle: Handle): Text with Files.read => Files.read(handle)
const unborrowed = (handle: Handle): Text => "x"
${main}
`,
  };
}

const HANDLE_ROWS: readonly Row[] = [
  { name: "borrowed method", body: "Files.read(handle)", reports: 0 },
  {
    name: "borrowed method twice",
    body: "Files.read(handle); Files.read(handle)",
    reports: 0,
  },
  { name: "borrow function", body: "borrowed(handle)", reports: 0 },
  {
    name: "both arguments borrowed",
    body: "Files.both(handle, handle)",
    reports: 0,
  },
  { name: "plain method", body: "Files.plain(handle)", reports: 1 },
  { name: "plain function", body: "unborrowed(handle)", reports: 1 },
  {
    name: "first argument not borrowed",
    body: "Files.second(handle, handle)",
    reports: 1,
  },
  { name: "return the handle", body: "handle", reports: 1 },
  {
    name: "use inside an arrow",
    body: "const later = () => Files.read(handle); later()",
    reports: 1,
  },
  {
    name: "copy the handle",
    body: "const copy = handle; Files.read(copy)",
    reports: 1,
  },
  {
    name: "one good use and one bad use",
    body: "Files.read(handle); Files.plain(handle)",
    reports: 1,
  },
];

for (const row of HANDLE_ROWS) {
  Deno.test(`borrowed handle in using: ${row.name}`, () => {
    const main =
      `const probe = (): Text with Files.open | Files.read | Files.plain | Files.both | Files.second | Files.close =>
  using (handle = Files.open()) { ${row.body} } finally { Files.close(handle) }`;
    assertEquals(
      reportsOf(handleProject(main), "main.eff", HANDLE),
      row.reports,
    );
  });
}

const PARAMETER_ROWS: readonly Row[] = [
  { name: "borrowed method", body: "Files.read(handle)", reports: 0 },
  { name: "plain method", body: "Files.plain(handle)", reports: 1 },
  { name: "return the handle", body: '{ handle; "x" }', reports: 1 },
  {
    name: "use inside an arrow",
    body: "{ const later = () => Files.read(handle); later() }",
    reports: 1,
  },
];

for (const row of PARAMETER_ROWS) {
  Deno.test(`borrow parameter: ${row.name}`, () => {
    const main =
      `const probe = (borrow handle: Handle): Text with Files.read | Files.plain => ${row.body}`;
    assertEquals(
      reportsOf(handleProject(main), "main.eff", HANDLE),
      row.reports,
    );
  });
}
