// Measures validator lines: totals, Phase 3 removal, and call-graph kernels.
// Code lines = lines that are not blank and not comment-only (trimmed line
// starts with //, /*, *, or */). Raw lines = all lines (wc -l semantics).
const ROOT = "/tmp/eff-sr8/repo/src/core";
const files: string[] = [];
for (const d of ["validate", "validate/families"]) for (const e of Deno.readDirSync(`${ROOT}/${d}`)) if (e.isFile && e.name.endsWith(".ts")) files.push(`${d}/${e.name}`);
files.push("validate_project.ts"); files.sort();
const text = new Map(files.map((f) => [f, Deno.readTextFileSync(`${ROOT}/${f}`).replace(/\n$/, "").split("\n")]));
const isComment = (l: string) => /^\s*(\/\/|\/\*|\*|\*\/)/.test(l);
const isCode = (l: string) => l.trim() !== "" && !isComment(l);
type Chunk = { id: string; file: string; name: string; cls?: string; start: number; end: number };
const chunks: Chunk[] = [];
const TOP = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_]\w*)/;
const METHOD = /^  (?:(?:private|protected|public|static|readonly|async|get|set)\s+)*([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*(?:\(|=\s*\()/;
for (const f of files) {
  const ls = text.get(f)!;
  const starts: { line: number; name: string; cls?: string }[] = [];
  let cls: string | undefined;
  ls.forEach((l, i) => {
    if (/^import\b/.test(l) && !starts.some((s) => s.name === "$imports")) { starts.push({ line: i, name: "$imports" }); cls = undefined; return; }
    const m = l.match(TOP);
    if (m) { cls = /\bclass\s/.test(l) ? m[1] : undefined; starts.push({ line: i, name: cls ? `${m[1]}#header` : m[1], cls }); return; }
    if (/^}/.test(l) && cls) { /* class end stays in last method */ }
    if (cls) { const mm = l.match(METHOD); if (mm && !["if", "for", "while", "switch", "return", "constructor"].includes(mm[1]) ) starts.push({ line: i, name: `${cls}.${mm[1]}`, cls }); }
  });
  // attach preceding contiguous comment lines to each start
  const adj = starts.map((s) => { let j = s.line; while (j > 0 && isComment(ls[j - 1]) ) j--; return { ...s, line: j }; });
  if (adj.length === 0 || adj[0].line > 0) adj.unshift({ line: 0, name: "$header" });
  adj.forEach((s, k) => chunks.push({ id: `${f}:${s.name}`, file: f, name: s.name, cls: s.cls, start: s.line, end: (k + 1 < adj.length ? adj[k + 1].line : ls.length) - 1 }));
}
const count = (f: string, lines: Iterable<number>) => { let raw = 0, code = 0; for (const i of lines) { raw++; if (isCode(text.get(f)![i])) code++; } return { raw, code }; };
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const fmt = (c: { raw: number; code: number }) => `${c.code} code / ${c.raw} raw`;
// ---- (a) totals
const per = files.map((f) => [f, count(f, range(0, text.get(f)!.length - 1))] as const);
const sum = (xs: { raw: number; code: number }[]) => xs.reduce((a, b) => ({ raw: a.raw + b.raw, code: a.code + b.code }), { raw: 0, code: 0 });
console.log("PER FILE"); for (const [f, c] of per) console.log(`  ${f}: ${fmt(c)}`);
console.log(`(a) TOTAL: ${fmt(sum(per.map((p) => p[1])))}`);
// ---- (b) Phase 3 removal
const REMOVED_KINDS = new Set(["map-groups","scan-stream","map-accum-stream","fold-stream","fold-effect-stream","collect-stream","head-stream","last-stream","drain-stream","aggregate-stream","merge-streams","zip-streams","concat-streams","flat-map-streams","switch-map-streams","catch-stream","retry-stream","debounce-stream","throttle-stream","take-stream","drop-stream","filter-effect-stream","take-while-effect-stream","take-until-effect-stream","drop-while-effect-stream"]);
const removedKind = (k: string) => REMOVED_KINDS.has(k) || k.startsWith("codec") || k.includes("fiber");
const REMOVED_STREAM_CHUNKS = ["StreamTerminal","STREAM_TERMINALS","StreamFlatten","STREAM_FLATTENS","StreamAccumulator","STREAM_ACCUMULATORS","StreamCount","STREAM_COUNTS","accumulateStream","streamTerminal","mapStreams","catchStream","retryStream","debounceStream","throttleStream","streamCount","effectStreamPredicate","mapGroups","groupKeyClass","groupReferences","aggregateStream","mergeStreams","zipStreams","concatStreams"];
const REMOVED_FN = new Set([...REMOVED_STREAM_CHUNKS, "codec", "codecOperation", "fiberOperation", "withFiber"]);
const removed = new Map<string, Set<number>>(files.map((f) => [f, new Set<number>()]));
const add = (f: string, ls: number[]) => ls.forEach((i) => removed.get(f)!.add(i));
const parts: [string, string, number[]][] = [];
const part = (label: string, f: string, ls: number[]) => { parts.push([label, f, ls]); add(f, ls); };
part("codec.ts (whole file)", "validate/families/codec.ts", range(0, text.get("validate/families/codec.ts")!.length - 1));
part("fiber.ts (whole file)", "validate/families/fiber.ts", range(0, text.get("validate/families/fiber.ts")!.length - 1));
const sch = text.get("validate/families/schema.ts")!;
const schTable: number[] = []; sch.forEach((l, i) => { if (/^  "(invalid|at|both)": \{/.test(l)) schTable.push(...range(i, i + 4)); });
const schFns = chunks.filter((c) => c.file.endsWith("schema.ts") && ["schemaInvalid","schemaAt","schemaBoth"].includes(c.name)).flatMap((c) => range(c.start, c.end));
part("schema.ts schemaInvalid/schemaAt/schemaBoth (functions + table entries)", "validate/families/schema.ts", [...schTable, ...schFns]);
part("stream.ts removed operators (functions + tables + types)", "validate/families/stream.ts", chunks.filter((c) => c.file.endsWith("stream.ts") && REMOVED_STREAM_CHUNKS.includes(c.name)).flatMap((c) => range(c.start, c.end)));
for (const f of ["validate/expr.ts", "validate/expr_walk.ts"]) {
  const ls = text.get(f)!; const out: number[] = []; let caseRun: boolean[] = []; let runLines: number[] = [];
  ls.forEach((l, i) => {
    const m = l.match(/^\s+case "([a-z-]+)":\s*$/);
    if (m) { caseRun.push(removedKind(m[1])); runLines.push(i); if (removedKind(m[1])) out.push(i); return; }
    if (caseRun.length && /^\s+return\b/.test(l)) { if (caseRun.every(Boolean)) { let j = i; out.push(j); while (!/;\s*$/.test(ls[j]) && j < ls.length - 1) { j++; out.push(j); } } }
    caseRun = []; runLines = [];
    if (f.endsWith("expr.ts") && i < 160) { const n = l.trim().replace(/,$/, ""); if (REMOVED_FN.has(n) || /families\/(codec|fiber)\.ts/.test(l)) out.push(i); }
  });
  part(`${f} dispatch cases and imports of removed kinds`, f, out);
}
console.log("(b) PHASE 3 REMOVAL"); for (const [label, f, ls] of parts) console.log(`  ${label}: ${fmt(count(f, ls))}`);
const remTotal = sum(files.map((f) => count(f, removed.get(f)!)));
console.log(`(b) TOTAL REMOVED: ${fmt(remTotal)}`);
const kept = (f: string, i: number) => !removed.get(f)!.has(i);
const total = sum(per.map((p) => p[1]));
console.log(`(c) AFTER PHASE 3: ${total.code - remTotal.code} code / ${total.raw - remTotal.raw} raw`);
// ---- call graph
const byName = new Map<string, Chunk[]>(); for (const c of chunks) { const k = `${c.file}|${c.name}`; byName.set(k, [...(byName.get(k) ?? []), c]); }
const imports = new Map<string, Map<string, string>>();
for (const f of files) {
  const src = text.get(f)!.join("\n"); const map = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
    const target = new URL(m[2], `file:///${f}`).pathname.slice(1);
    if (!files.includes(target)) continue;
    for (const n of m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean)) map.set(n, target);
  }
  imports.set(f, map);
}
const methodsOf = new Map<string, string[]>(); for (const c of chunks) if (c.cls && c.name.includes(".")) { const n = c.name.split(".")[1]; methodsOf.set(n, [...(methodsOf.get(n) ?? []), c.id]); }
const chunkById = new Map(chunks.map((c) => [c.id, c]));
const UNKNOWN = new Map<string, number>();
function refs(c: Chunk): string[] {
  const ls = text.get(c.file)!; const body = range(c.start, c.end).filter((i) => kept(c.file, i) && !isComment(ls[i])).map((i) => ls[i]).join("\n").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const out = new Set<string>();
  for (const m of body.matchAll(/(?<![.\w])([A-Za-z_]\w*)\b/g)) {
    const n = m[1];
    const local = byName.get(`${c.file}|${n}`) ?? byName.get(`${c.file}|${n}#header`);
    if (local) { local.forEach((x) => out.add(x.id)); continue; }
    const t = imports.get(c.file)!.get(n);
    if (t) (byName.get(`${t}|${n}`) ?? byName.get(`${t}|${n}#header`) ?? []).forEach((x) => out.add(x.id));
  }
  for (const m of body.matchAll(/\.\s*([A-Za-z_]\w*)/g)) {
    const n = m[1]; const recv = (body.slice(0, m.index).match(/(\w+|\))\s*$/) ?? ["", ""])[1]; const cands = methodsOf.get(n) ?? [];
    if (recv === "this" && c.cls) { const id = `${c.file}:${c.cls}.${n}`; if (chunkById.has(id)) out.add(id); continue; }
    if (recv === "refinements") { cands.filter((x) => x.includes("RefinementValidator.")).forEach((x) => out.add(x)); continue; }
    if (recv === "c" || recv === "core") { cands.filter((x) => x.includes("BodyValidator.")).forEach((x) => out.add(x)); continue; }
    if (recv === "report") { cands.filter((x) => x.includes("Report.")).forEach((x) => out.add(x)); continue; }
    if (recv === ")") { cands.forEach((x) => out.add(x)); continue; }
    if (cands.length) UNKNOWN.set(recv, (UNKNOWN.get(recv) ?? 0) + 1);
  }
  out.delete(c.id); return [...out];
}
const graph = new Map(chunks.map((c) => [c.id, refs(c)]));
function closure(roots: string[], exclude: (id: string) => boolean = () => false): Set<string> {
  const seen = new Set<string>(); const stack = [...roots];
  while (stack.length) { const id = stack.pop()!; if (seen.has(id) || !chunkById.has(id)) continue; if (seen.size && exclude(id) && !roots.includes(id)) continue; seen.add(id); stack.push(...(graph.get(id) ?? [])); }
  return seen;
}
const lineSet = (ids: Iterable<string>, extra: [string, number[]][] = []) => { const m = new Map<string, Set<number>>(); for (const id of ids) { const c = chunkById.get(id)!; const s = m.get(c.file) ?? new Set(); range(c.start, c.end).filter((i) => kept(c.file, i)).forEach((i) => s.add(i)); m.set(c.file, s); } for (const [f, ls] of extra) { const s = m.get(f) ?? new Set(); ls.forEach((i) => s.add(i)); m.set(f, s); } return m; };
const measure = (m: Map<string, Set<number>>) => sum([...m].map(([f, s]) => count(f, s)));
const show = (label: string, ids: Set<string>, extra: [string, number[]][] = []) => { const m = lineSet(ids, extra); console.log(`${label}: ${fmt(measure(m))} in ${ids.size} chunks`); console.log("    files: " + [...m].map(([f, s]) => `${f.replace("validate/", "")}=${count(f, s).code}`).join(", ")); console.log("    chunks: " + [...ids].map((i) => i.replace(/^validate\//, "")).sort().join(" ")); };
const BV = (id: string) => id.includes(":BodyValidator.");
const RV = ["adoption","retain","audit","snapshot","restore","leaveScope","join","addLocal","release","addBranch","clearDerivedFacts","condition","literalMatch"].map((n) => `validate/refinements.ts:RefinementValidator.${n}`);
const branchLines = range(1632, 1703);
const branchRefs = (() => { const fake: Chunk = { id: "x", file: "validate/expr.ts", name: "x", start: 1632, end: 1703 }; return refs(fake).filter((id) => !BV(id)); })();
const k1 = closure([...RV, "validate/refinements.ts:RefinementValidator#header", "validate/refinements.ts:negateRefinement", ...branchRefs], BV);
console.log("--- kernels (after Phase 3; BodyValidator methods excluded from K1/K2 traversal)");
show("K1 proof check: RefinementValidator closure + expr.ts:1633-1704", k1, [["validate/expr.ts", branchLines]]);
const lit = chunks.find((c) => c.file === "validate/typing.ts" && c.start <= 241 && c.end >= 241)!;
console.log(`  int literal rule lives in chunk ${lit.id} lines ${lit.start + 1}-${lit.end + 1}`);
const k2 = closure([lit.id], BV);
show("K2 int literal", k2);
show("K1+K2", new Set([...k1, ...k2]), [["validate/expr.ts", branchLines]]);
const k3 = closure(["validate/expr.ts:BodyValidator.checkFunction"]);
show("K3 inferred contract (closure of BodyValidator.checkFunction, full walk)", k3);
const all = closure(["validate/index.ts:validateModule", "validate_project.ts:validateProject"]);
show("FULL closure from validateProject", all);
const struct = closure(["validate/serialization.ts:checkSerialization", "validate/world.ts:checkDeclarationHeaders", "validate/world.ts:checkImports", "validate_project.ts:validateProject"].filter((i) => chunkById.has(i)), (id) => id.endsWith(":validateModule") || BV(id));
show("STRUCT serialization + headers + imports + producer binding", struct);
const optB = closure([...k1, ...struct, "validate/expr_walk.ts:exprChildren"], BV);
show("OPTION B: K1 + STRUCT + exprChildren (BodyValidator excluded)", optB, [["validate/expr.ts", branchLines]]);
console.log("unknown receivers of class-method names (ignored): " + [...UNKNOWN].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([r, n]) => `${r}=${n}`).join(" "));
const unreached = chunks.filter((c) => !all.has(c.id) && measure(lineSet([c.id])).code > 0).map((c) => c.id);
console.log("chunks not reached from validateProject: " + unreached.join(" "));
