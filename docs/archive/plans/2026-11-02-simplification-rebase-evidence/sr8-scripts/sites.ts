// Lists each rejection site: file:line, enclosing function, area, message text.
const files = Deno.args;
for (const f of files) {
  const lines = Deno.readTextFileSync(f).split("\n");
  const fnAt = (i: number): string => {
    for (let j = i; j >= 0; j--) {
      const l = lines[j];
      let m = l.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (m) return m[1];
      m = l.match(/^  (?:private\s+|protected\s+|public\s+|static\s+)*(\w+)\s*[(<]/);
      if (m && !["if", "for", "while", "switch", "return"].includes(m[1])) return m[1];
      m = l.match(/^(?:export\s+)?const\s+(\w+)\s*[:=]/);
      if (m) return m[1];
    }
    return "?";
  };
  lines.forEach((l, i) => {
    const m = l.match(/AREA\.(\w+)|addDepth\(/);
    if (!m) return;
    if (/^\s*(\/\/|\*)/.test(l)) return;
    let text = "";
    for (let j = i; j < Math.min(i + 12, lines.length); j++) {
      text += " " + lines[j].trim();
      if (/\);\s*$/.test(lines[j]) || /\)\s*;?$/.test(lines[j]) && j > i + 1) break;
    }
    const strs = [...text.matchAll(/(`[^`]*`|"[^"]*")/g)].map((s) => s[1]).filter((s) => s.length > 6);
    console.log(`${f}:${i + 1} | ${fnAt(i)} | ${m[1] ?? "depth"} | ${strs.join(" + ").slice(0, 160)}`);
  });
}
