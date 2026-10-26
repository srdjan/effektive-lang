// Regenerates fixtures/golden/<module>.ts from fixtures/examples and from
// fixtures/emit/traverse, the sixth golden module. The companion module of the
// host interface goes to fixtures/golden/host/providers.effi.ts.
// It also writes fixtures/ir/examples-baseline.json, the IR, emitted text, source map,
// and interface hash of the examples and of one case of resource and schema forms.
// Run it with `deno task golden:update` after a deliberate change of the emitter.

import {
  emitExamples,
  emitFiles,
  exampleFiles,
  irSnapshot,
  projectFiles,
} from "../tests/helpers.ts";

const directory = new URL("../fixtures/golden/", import.meta.url);
Deno.mkdirSync(directory, { recursive: true });
const traverse = emitFiles(projectFiles("emit/traverse"), ["traverse.eff"]);
for (const module of [...emitExamples().values(), ...traverse.values()]) {
  const file = new URL(module.path, directory);
  Deno.mkdirSync(new URL(".", file), { recursive: true });
  Deno.writeTextFileSync(file, module.text);
  console.log(`wrote fixtures/golden/${module.path}`);
}

const resourceCase = [
  "type Int = int",
  "service Jobs { open(): { read: () => Int, close: () => void }; next(): Int }",
  "export const resource = (): Int uses Jobs.open => withResource(() => Jobs.open(), (job) => job.read(), (job) => job.close())",
  "export const fiber = (): Int uses Jobs.next => withFiber(defer(() => Jobs.next()), (fiber) => joinFiber(fiber))",
  "const groups = (source: Stream<Int>) => mapGroups(source, (n) => n, (key, group) => collectStream(group), { bufferSize: 1 })",
  "const policy = scheduleConcat(scheduleMax(scheduleRecurs(1), scheduleSpaced(2)), scheduleMin(scheduleRecurs(2), scheduleSpaced(1)))",
  "const numberSchema: Schema<Int> = schema()",
  "export const decoded = (input: unknown): Int fails SchemaError => schemaDecode(numberSchema, input)",
  "export const encoded = (input: Int): Int fails SchemaError => schemaEncode(numberSchema, input)",
  "export const made = (input: Int): Int fails SchemaIssue => schemaMake(numberSchema, input)",
  "",
].join("\n");

const baseline = [
  exampleFiles(),
  { "effektive.json": "{}", "m.eff": resourceCase },
].map((files) => ({ files, modules: irSnapshot(files).modules }));
const irDirectory = new URL("../fixtures/ir/", import.meta.url);
Deno.writeTextFileSync(
  new URL("examples-baseline.json", irDirectory),
  JSON.stringify(baseline, null, 2) + "\n",
);
console.log("wrote fixtures/ir/examples-baseline.json");
