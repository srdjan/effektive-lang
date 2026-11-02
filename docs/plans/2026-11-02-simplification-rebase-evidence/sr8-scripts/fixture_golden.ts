// For each forged fixture: does the emitted TypeScript differ from the emission
// of the true lowering? A difference on a golden module means the golden test
// would fail for that example. Also reports equality with fixtures/golden/<m>.ts.
import { checkProject, lowerProject } from "/tmp/eff-sr8/repo/src/core/frontend.ts";
import type { SourceHost } from "/tmp/eff-sr8/repo/src/core/frontend.ts";
import { emitProject } from "/tmp/eff-sr8/repo/src/core/typescript.ts";
const REPO = "/tmp/eff-sr8/repo";
const host: SourceHost = { readText(p: string) { try { return { ok: true, value: Deno.readTextFileSync(p) }; } catch { return { ok: false, error: { tag: "not-found", path: p } }; } } };
function emitAll(project: string, forged?: { module: string }) {
  const dir = `${REPO}/fixtures/${project}`;
  const entries = [...Deno.readDirSync(dir)].filter((e) => e.name.endsWith(".eff")).map((e) => e.name).sort();
  const checked = checkProject(host, dir, entries);
  if (!checked.ok) throw new Error("check");
  const lowered = new Map(lowerProject(checked.value));
  // deno-lint-ignore no-explicit-any
  if (forged) lowered.set(forged.module, { ok: true, value: forged as any });
  const out = new Map<string, string>();
  for (const [n, m] of emitProject(lowered, { config: checked.value.analysis.project.config })) out.set(n, m.ok ? m.value.text : `EMIT-ERROR ${m.error.message}`);
  return out;
}
const base = { examples: emitAll("examples"), ir: emitAll("ir") };
for (const [n, t] of base.examples) {
  let g = "no golden";
  try { g = Deno.readTextFileSync(`${REPO}/fixtures/golden/${n}.ts`) === t ? "golden equal" : "golden differs"; } catch { /* none */ }
  console.log(`BASE examples/${n}: ${g}`);
}
const manifest = JSON.parse(Deno.readTextFileSync(`${REPO}/fixtures/validate/manifest.json`)).fixtures;
for (const f of manifest) {
  const project = (Object.values(f.sources)[0] as string).split("/")[0] as "examples" | "ir";
  const ir = JSON.parse(Deno.readTextFileSync(`${REPO}/fixtures/validate/${f.file}`));
  const out = emitAll(project, ir);
  const diff = [...out].filter(([n, t]) => base[project].get(n) !== t).map(([n, t]) => t.startsWith("EMIT-ERROR") ? `${n}(emit error)` : `${n}(text differs)`);
  console.log(`${f.file} | module ${ir.module} | ${diff.join(", ") || "emitted text identical"}`);
}
