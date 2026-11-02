// For each mutation fixture in fixtures/validate/, replaces the lowered IR of
// its module with the forged IR, emits the project with the public emitProject,
// and runs the strict target check (deno check with the CLI compiler options).
// Records: the emit result (the emitter guard) and the deno check result.
import { checkProject, lowerProject } from "/tmp/eff-sr8/repo/src/core/frontend.ts";
import type { ModuleIR, SourceHost } from "/tmp/eff-sr8/repo/src/core/frontend.ts";
import { emitProject } from "/tmp/eff-sr8/repo/src/core/typescript.ts";
import { TARGET_COMPILER_OPTIONS, TARGET_IMPORTS } from "/tmp/eff-sr8/repo/src/cli/tsc.ts";

const REPO = "/tmp/eff-sr8/repo";
const fileHost: SourceHost = {
  readText(path: string) {
    try {
      return { ok: true, value: Deno.readTextFileSync(path) };
    } catch {
      return { ok: false, error: { tag: "not-found", path } };
    }
  },
};
async function copy(from: string, to: string) {
  await new Deno.Command("cp", { args: ["-R", from + "/.", to] }).output();
}
async function run(projectDir: string, forged: ModuleIR | undefined) {
  const dir = await Deno.makeTempDir({ prefix: "sr8-" });
  await copy(projectDir, dir);
  const entries = [...Deno.readDirSync(dir)].filter((e) => e.name.endsWith(".eff")).map((e) => e.name).sort();
  const checked = checkProject(fileHost, dir, entries);
  if (!checked.ok) return { emit: "checkProject failed", check: "-" };
  const lowered = new Map(lowerProject(checked.value));
  if (forged) lowered.set(forged.module, { ok: true, value: forged });
  let emitted;
  try {
    emitted = emitProject(lowered, { config: checked.value.analysis.project.config });
  } catch (e) {
    return { emit: `emitProject threw: ${e instanceof Error ? e.message : e}`.slice(0, 200), check: "-" };
  }
  const paths: string[] = [];
  const emitErrors: string[] = [];
  for (const [name, m] of emitted) {
    if (!m.ok) { emitErrors.push(`${name}: ${JSON.stringify(m.error)}`.slice(0, 200)); continue; }
    const target = `${dir}/${m.value.path}`;
    Deno.mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(target, m.value.text);
    paths.push(m.value.path);
  }
  Deno.writeTextFileSync(`${dir}/deno.json`, JSON.stringify({ compilerOptions: TARGET_COMPILER_OPTIONS, imports: TARGET_IMPORTS }));
  const hosts = [...Deno.readDirSync(dir)].filter((e) => e.name.endsWith(".ts") && !paths.includes(e.name) && e.isFile).map((e) => e.name);
  const out = await new Deno.Command("deno", { args: ["check", "--config", "deno.json", ...paths, ...hosts], cwd: dir }).output();
  const stderr = new TextDecoder().decode(out.stderr).replace(/\x1b\[[0-9;]*m/g, "");
  const errs = stderr.split("\n").filter((l) => /^(TS\d+|error)/.test(l)).slice(0, 3);
  await Deno.remove(dir, { recursive: true });
  return { emit: emitErrors.length ? emitErrors.join("; ") : "ok", check: `exit ${out.code}${errs.length ? " " + errs.join(" / ") : ""}`.slice(0, 400) };
}
const manifest = JSON.parse(Deno.readTextFileSync(`${REPO}/fixtures/validate/manifest.json`)).fixtures;
const projectOf = (sources: Record<string, string>) => `${REPO}/fixtures/` + Object.values(sources)[0].split("/")[0];
const only = Deno.args[0];
if (!only) {
  for (const p of ["examples", "ir"]) console.log(`BASELINE ${p} |`, JSON.stringify(await run(`${REPO}/fixtures/${p}`, undefined)));
}
for (const f of manifest) {
  if (only && !f.file.includes(only)) continue;
  const ir = JSON.parse(Deno.readTextFileSync(`${REPO}/fixtures/validate/${f.file}`));
  console.log(`${f.file} |`, JSON.stringify(await run(projectOf(f.sources), ir)));
}
