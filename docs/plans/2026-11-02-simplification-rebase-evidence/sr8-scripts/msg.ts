// Prints the whitespace-collapsed text of the report call at file:line.
for (const spec of Deno.args) {
  const [f, ls] = spec.split(":");
  const lines = Deno.readTextFileSync(`/tmp/eff-sr8/repo/src/core/validate/${f}`).split("\n");
  for (const l of ls.split(",").map(Number)) {
    let depth = 0, out = "", started = false;
    for (let i = l - 2; i < lines.length && i < l + 14; i++) {
      for (const ch of lines[i]) { out += ch; if (ch === "(") { depth++; started = true; } if (ch === ")") depth--; }
      out += " ";
      if (started && depth <= 0 && i >= l - 1) break;
    }
    console.log(`${f}:${l} ${out.replace(/\s+/g, " ").replace(/^.*?(add\w*\(|this\.add|c\.add)/, "$1").slice(0, 230)}`);
  }
}
