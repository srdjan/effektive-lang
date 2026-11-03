// Tests of scripts/mutate.ts through its command line. Each test builds its own
// tiny git repository in a temporary directory, because the tool mutates
// `git archive` copies of HEAD and a mutate copy is not a git repository. The
// repository holds a copy of the tool, a fixture module, and a fixture test
// that kills some mutants and not others, so the expected survivors are known.

import { assertEquals, assertStringIncludes } from "@std/assert";

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const SAMPLE_PATH = "src/sample.ts";
const REGISTER_PATH = "fixtures/mutation/survivors.json";

/** A comparison of exactly `length` characters. */
function comparison(length: number): string {
  return `right === "${"x".repeat(length - 12)}"`;
}

const SAMPLE = `export function grade(score: number): string {
  if (score >= 50) {
    return "pass";
  }
  return "fail";
}

export function untested(right: string): string {
  if (${comparison(57)}) {
    return "a";
  }
  if (${comparison(58)}) {
    return "b";
  }
  const exact = ${comparison(60)};
  const over = ${comparison(61)};
  return \`\${exact}\${over}\`;
}
`;

const OTHER = `export function sign(n: number): string {
  if (n < 0) {
    return "neg";
  }
  return "pos";
}
`;

const SAMPLE_TEST = `import { grade } from "../src/sample.ts";
import { sign } from "../src/other.ts";

Deno.test("grade", () => {
  if (grade(80) !== "pass") throw new Error("80 must pass");
  if (grade(10) !== "fail") throw new Error("10 must fail");
});

Deno.test("sign", () => {
  if (sign(-1) !== "neg") throw new Error("-1 must be neg");
  if (sign(0) !== "pos") throw new Error("0 must be pos");
});
`;

const FIXTURE: Readonly<Record<string, string>> = {
  [SAMPLE_PATH]: SAMPLE,
  "src/other.ts": OTHER,
  "tests/sample_test.ts": SAMPLE_TEST,
  [REGISTER_PATH]: "[]\n",
};

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<Run> {
  const result = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

/** Writes the tool, the project files, and the fixture files into `dir`. */
async function lay(
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await Deno.mkdir(`${dir}/scripts`, { recursive: true });
  const tool = new URL("../scripts/mutate.ts", import.meta.url);
  await Deno.copyFile(tool, `${dir}/scripts/mutate.ts`);
  for (const name of ["deno.json", "deno.lock"]) {
    await Deno.copyFile(
      new URL(`../${name}`, import.meta.url),
      `${dir}/${name}`,
    );
  }
  for (const [path, text] of Object.entries(files)) {
    await Deno.mkdir(`${dir}/${path.split("/").slice(0, -1).join("/")}`, {
      recursive: true,
    });
    await Deno.writeTextFile(`${dir}/${path}`, text);
  }
}

/** Makes a repository with one commit, runs `body` in it, and removes it. */
async function inRepo(
  files: Readonly<Record<string, string>>,
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "effektive-mutate-tool-" });
  try {
    await lay(dir, files);
    await runCommand("git", ["init", "-q"], dir);
    await runCommand("git", ["add", "-A"], dir);
    const committed = await runCommand("git", [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-q",
      "-m",
      "fixture",
    ], dir);
    assertEquals(committed.code, 0, committed.stderr);
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Runs the copy of the tool in `dir`. The tool has no type-checked imports. */
async function mutate(dir: string, args: string[]): Promise<Run> {
  const run = await runCommand(
    Deno.execPath(),
    ["run", "--no-check", "--allow-all", "scripts/mutate.ts", ...args],
    dir,
  );
  return { ...run, stdout: run.stdout.replace(/elapsed \d+ s/, "elapsed N s") };
}

const TESTS = ["--tests", "tests/sample_test.ts"];

Deno.test("an unregistered survivor gives exit 1 and its row", async () => {
  await inRepo(FIXTURE, async (dir) => {
    const run = await mutate(dir, [
      "--seed",
      "1",
      "--sample",
      "all",
      "--workers",
      "2",
      ...TESTS,
      SAMPLE_PATH,
      "src/other.ts",
    ]);
    assertEquals(run.stderr, "");
    assertEquals(
      run.stdout,
      [
        "module sites sampled killed survived timeout",
        "src/sample.ts 8 8 1 7 0",
        "src/other.ts 2 2 2 0 0",
        "src/sample.ts:2 comparison: score >= 50 -> >",
        '{"file":"src/sample.ts","declaration":"grade","offset":53,"text":"score >= 50","operator":"comparison","class":"","reason":""}',
        'src/sample.ts:9 negate-if: right === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" -> !(right === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")',
        '{"file":"src/sample.ts","declaration":"untested","offset":56,"text":"right === \\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\"","operator":"negate-if","class":"","reason":""}',
        'src/sample.ts:9 comparison: right === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" -> !==',
        '{"file":"src/sample.ts","declaration":"untested","offset":56,"text":"right === \\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\"","operator":"comparison","class":"","reason":""}',
        'src/sample.ts:12 negate-if: right === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" -> !(right === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...',
        '{"file":"src/sample.ts","declaration":"untested","offset":143,"text":"right === \\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\"","operator":"negate-if","class":"","reason":""}',
        'src/sample.ts:12 comparison: right === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" -> !==',
        '{"file":"src/sample.ts","declaration":"untested","offset":143,"text":"right === \\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\"","operator":"comparison","class":"","reason":""}',
        'src/sample.ts:15 comparison: right === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" -> !==',
        '{"file":"src/sample.ts","declaration":"untested","offset":241,"text":"right === \\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\"","operator":"comparison","class":"","reason":""}',
        'src/sample.ts:16 comparison: right === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx... -> !==',
        '{"file":"src/sample.ts","declaration":"untested","offset":318,"text":"right === \\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\"","operator":"comparison","class":"","reason":""}',
        "unregistered survivors 7, stale rows 0, elapsed N s",
      ].join("\n") + "\n",
    );
    assertEquals(run.code, 1);
  });
});

Deno.test("a survivor with a matching row gives exit 0", async () => {
  const row = {
    file: SAMPLE_PATH,
    declaration: "grade",
    offset: 53,
    text: "score >= 50",
    operator: "comparison",
    class: "equivalent",
    reason: "The fixture never tests a score of 50.",
  };
  await inRepo({
    ...FIXTURE,
    [REGISTER_PATH]: JSON.stringify([row]),
  }, async (dir) => {
    const run = await mutate(dir, [
      ...TESTS,
      "--only",
      `${SAMPLE_PATH}:2`,
      SAMPLE_PATH,
    ]);
    assertEquals(run.stderr, "");
    assertEquals(
      run.stdout,
      [
        "module sites sampled killed survived timeout",
        "src/sample.ts 8 2 1 1 0",
        "src/sample.ts:2 comparison: score >= 50 -> >",
        '{"file":"src/sample.ts","declaration":"grade","offset":53,"text":"score >= 50","operator":"comparison","class":"equivalent","reason":"The fixture never tests a score of 50."}',
        "unregistered survivors 0, stale rows 0, elapsed N s",
      ].join("\n") + "\n",
    );
    assertEquals(run.code, 0);
  });
});

Deno.test("a row that matches no site is stale and gives exit 1", async () => {
  const row = {
    file: SAMPLE_PATH,
    declaration: "grade",
    offset: 53,
    text: "score >= 50",
    operator: "comparison",
    class: "equivalent",
    reason: "The fixture never tests a score of 50.",
  };
  const stale = { ...row, text: "score >= 51" };
  await inRepo({
    ...FIXTURE,
    [REGISTER_PATH]: JSON.stringify([row, stale]),
  }, async (dir) => {
    const run = await mutate(dir, [
      ...TESTS,
      "--only",
      `${SAMPLE_PATH}:2`,
      SAMPLE_PATH,
    ]);
    assertEquals(run.stderr, "");
    assertEquals(
      run.stdout,
      [
        "module sites sampled killed survived timeout",
        "src/sample.ts 8 2 1 1 0",
        "src/sample.ts:2 comparison: score >= 50 -> >",
        '{"file":"src/sample.ts","declaration":"grade","offset":53,"text":"score >= 50","operator":"comparison","class":"equivalent","reason":"The fixture never tests a score of 50."}',
        'stale register row: {"file":"src/sample.ts","declaration":"grade","offset":53,"text":"score >= 51","operator":"comparison","class":"equivalent","reason":"The fixture never tests a score of 50."}',
        "unregistered survivors 0, stale rows 1, elapsed N s",
      ].join("\n") + "\n",
    );
    assertEquals(run.code, 1);
  });
});

Deno.test("a failing clean run gives exit 2", async () => {
  await inRepo({
    ...FIXTURE,
    "tests/sample_test.ts": `Deno.test("fails", () => {
  throw new Error("the clean run fails");
});
`,
  }, async (dir) => {
    const run = await mutate(dir, [...TESTS, SAMPLE_PATH]);
    assertEquals(run.stdout, "");
    assertStringIncludes(run.stderr, "mutate: the clean run failed:\n");
    assertStringIncludes(run.stderr, "the clean run fails");
    assertEquals(run.code, 2);
  });
});

Deno.test("a mutant that leaves no test to run gives exit 2", async () => {
  await inRepo({
    ...FIXTURE,
    [SAMPLE_PATH]: `export function enabled(n: number): boolean {
  if (n === 1) {
    return true;
  }
  return false;
}
`,
    "tests/sample_test.ts": `import { enabled } from "../src/sample.ts";

if (enabled(1)) {
  Deno.test("enabled", () => {
    if (!enabled(1)) throw new Error("1 must be enabled");
  });
}
`,
  }, async (dir) => {
    const run = await mutate(dir, [...TESTS, "--workers", "1", SAMPLE_PATH]);
    assertEquals(run.stdout, "");
    assertStringIncludes(
      run.stderr,
      "mutate: no test ran for src/sample.ts:2 negate-if: n === 1 -> !(n === 1):\n",
    );
    assertEquals(run.code, 2);
  });
});

Deno.test("an invalid command line or register gives exit 2 and one message", async () => {
  const cases: {
    readonly args: string[];
    readonly register: string;
    readonly error: string;
  }[] = [
    {
      args: ["--seed", "x", SAMPLE_PATH],
      register: "[]",
      error: "mutate: --seed must be a non-negative integer\n",
    },
    {
      args: [SAMPLE_PATH],
      register: "{}",
      error:
        "mutate: fixtures/mutation/survivors.json: the register must be an array\n",
    },
    {
      args: ["src/missing.ts", ...TESTS],
      register: "[]",
      error: "mutate: src/missing.ts is not a file in HEAD\n",
    },
  ];
  await inRepo(FIXTURE, async (dir) => {
    for (const { args, register, error } of cases) {
      await Deno.writeTextFile(`${dir}/${REGISTER_PATH}`, register);
      const run = await mutate(dir, args);
      assertEquals([run.code, run.stdout, run.stderr], [2, "", error]);
    }
  });
});

Deno.test("a missing register gives exit 2", async () => {
  const { [REGISTER_PATH]: _register, ...withoutRegister } = FIXTURE;
  await inRepo(withoutRegister, async (dir) => {
    const run = await mutate(dir, [SAMPLE_PATH]);
    assertEquals([run.code, run.stdout], [2, ""]);
    // The rest of the message is the text of the operating system.
    assertStringIncludes(
      run.stderr,
      "mutate: cannot read fixtures/mutation/survivors.json: ",
    );
  });
});

Deno.test("a directory that is not a git repository gives exit 2", async () => {
  const dir = await Deno.makeTempDir({ prefix: "effektive-mutate-tool-" });
  try {
    await lay(dir, FIXTURE);
    const run = await mutate(dir, [...TESTS, SAMPLE_PATH]);
    assertEquals(run.stdout, "");
    assertStringIncludes(run.stderr, "mutate: git archive failed: ");
    assertEquals(run.code, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
