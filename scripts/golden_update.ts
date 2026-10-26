// Regenerates fixtures/golden/<module>.ts from fixtures/examples and from
// fixtures/emit/traverse, the sixth golden module. The companion module of the
// host interface goes to fixtures/golden/host/providers.effi.ts.
// It also writes fixtures/ir/examples-baseline.json, the IR, emitted text, source map,
// and interface hash of the examples and of one case of resource and schema forms.
// Run it with `deno task golden:update` after a deliberate change of the emitter.

import { Program, serializeModule } from "../src/core/frontend.ts";
import {
  serializeSourceMap,
  TypeScriptOutputs,
} from "../src/core/typescript.ts";
import {
  emitExamples,
  emitFiles,
  exampleFiles,
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

/** One snapshot per corpus: the sources and, for each module in name order, the five compared outputs. */
function snapshot(files: Record<string, string>) {
  const program = new Program();
  const outputs = new TypeScriptOutputs();
  const updated = program.update({ set: files });
  if (!updated.ok || updated.value.diagnostics.length > 0) {
    throw new Error("snapshot corpus does not check");
  }
  const revision = updated.value;
  const modules = [...revision.moduleNames()].sort().map((name) => {
    const ir = revision.lowered(name);
    const emitted = outputs.emitted(revision, name);
    const map = outputs.sourceMap(revision, name);
    if (!(ir?.ok && emitted?.ok && map?.ok)) {
      throw new Error(`snapshot module ${name} fails`);
    }
    const text = serializeModule(ir.value);
    if (!text.ok) throw new Error(`snapshot module ${name} does not serialize`);
    return {
      name,
      // `generated` holds capture data, not IR contract.
      ir: JSON.parse(
        text.value,
        (key, value: unknown) => key === "generated" ? undefined : value,
      ),
      emitted: emitted.value,
      map: serializeSourceMap(map.value),
      hash: revision.interfaceHash(name),
    };
  });
  return { files, modules };
}

const baseline = [
  snapshot(exampleFiles()),
  snapshot({ "effektive.json": "{}", "m.eff": resourceCase }),
];
const irDirectory = new URL("../fixtures/ir/", import.meta.url);
Deno.writeTextFileSync(
  new URL("examples-baseline.json", irDirectory),
  JSON.stringify(baseline, null, 2) + "\n",
);
console.log("wrote fixtures/ir/examples-baseline.json");
