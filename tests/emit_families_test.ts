// The builtin families of the emitter use `families/context.ts` and never
// import `expr.ts`. An import of `expr.ts` makes an import cycle.

import { assert } from "@std/assert";

Deno.test("src/core/emit/families imports only ir.ts, ids.ts, and emit files other than expr.ts", () => {
  const directory = new URL("../src/core/emit/families/", import.meta.url);
  const emit = new URL("../src/core/emit/", import.meta.url);
  const files: URL[] = [];
  for (const entry of Deno.readDirSync(directory)) {
    assert(entry.isFile, `unexpected entry ${entry.name}`);
    files.push(new URL(entry.name, directory));
  }
  const expr = new URL("expr.ts", emit).href;
  const allowed = new Set(
    ["ir.ts", "ids.ts"].map((name) => new URL(`../${name}`, emit).href),
  );
  const pattern =
    /(?:^|[\s;])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  let checked = 0;
  for (const file of files) {
    const text = Deno.readTextFileSync(file);
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      assert(
        specifier.startsWith("."),
        `${file.pathname} imports ${specifier}`,
      );
      const target = new URL(specifier, file).href;
      const inEmit = target.startsWith(emit.href) && target !== expr;
      assert(
        inEmit || allowed.has(target),
        `${file.pathname} imports ${specifier}`,
      );
      checked++;
    }
  }
  assert(files.length >= 1, "no family file found");
  assert(checked >= 1, "no import found");
});

Deno.test("the value imports of src/core/emit reach no checker-phase module", () => {
  const core = new URL("../src/core/", import.meta.url);
  const emit = new URL("emit/", core);
  const roots: URL[] = [];
  const collect = (dir: URL): void => {
    for (const entry of Deno.readDirSync(dir)) {
      if (entry.isDirectory) collect(new URL(`${entry.name}/`, dir));
      else roots.push(new URL(entry.name, dir));
    }
  };
  collect(emit);
  // Group 1 marks a type-only clause. Groups 2, 3, and 4 hold the specifier of a
  // clause, a bare import, and a dynamic import.
  const pattern =
    /(?:^|[\s;])(?:import|export)\s+(type\s)?[^;]*?from\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const closure = new Set(roots.map((file) => file.href));
  const queue = [...roots];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const match of Deno.readTextFileSync(file).matchAll(pattern)) {
      if (match[1] !== undefined) continue;
      const specifier = match[2] ?? match[3] ?? match[4];
      if (!specifier.startsWith(".")) continue;
      const target = new URL(specifier, file);
      if (closure.has(target.href)) continue;
      closure.add(target.href);
      queue.push(target);
    }
  }
  const outside = [...closure]
    .filter((href) => !href.startsWith(emit.href))
    .map((href) => href.slice(core.href.length))
    .sort();
  const forbidden = outside.filter((name) =>
    /^(types|modes|project|parse|index|lower|resolve|check.*)\.ts$/.test(name)
  );
  assert(forbidden.length === 0, `emit reaches ${forbidden.join(", ")}`);
  assert(outside.length > 0, "no import outside emit found");
});
