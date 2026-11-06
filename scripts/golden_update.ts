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
import { prettyJson } from "./lib.ts";

const directory = new URL("../fixtures/golden/", import.meta.url);
Deno.mkdirSync(directory, { recursive: true });
const traverse = emitFiles(projectFiles("emit/traverse"), ["traverse.eff"]);
for (const module of [...emitExamples().values(), ...traverse.values()]) {
  const file = new URL(module.path, directory);
  Deno.mkdirSync(new URL(".", file), { recursive: true });
  Deno.writeTextFileSync(file, module.text);
  console.log(`wrote fixtures/golden/${module.path}`);
}

const resourceCase = Deno.readTextFileSync(
  new URL("../fixtures/ir/resource-case.eff", import.meta.url),
);

const baseline = [
  exampleFiles(),
  { "effektive.json": "{}", "m.eff": resourceCase },
].map((files) => ({ files, modules: irSnapshot(files).modules }));
const irDirectory = new URL("../fixtures/ir/", import.meta.url);
Deno.writeTextFileSync(
  new URL("examples-baseline.json", irDirectory),
  prettyJson(baseline),
);
console.log("wrote fixtures/ir/examples-baseline.json");
