// Runs the slow tests with a fresh DENO_DIR, and removes that DENO_DIR after.
// The slow tests run `deno` in random temporary directories. Deno keeps one
// cache entry for each such path, so a shared DENO_DIR grows on each run.
// Run it with `deno task test:slow`. Extra arguments go to `deno test`.
//
// Several slow tests run `deno bundle`. When two of them start at the same
// time on the empty DENO_DIR, they race to install esbuild, and one fails with
// "failed to copy esbuild binary". So one bundle of a stub installs esbuild
// first. A failed warm-up prints its error, and the tests then run as before.

const denoDir = Deno.makeTempDirSync({ prefix: "effektive-slow-deno-dir-" });
let code = 1;
try {
  const stub = `${denoDir}/warm-up.ts`;
  Deno.writeTextFileSync(stub, "export {};\n");
  const warmUp = await new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--no-config",
      "--quiet",
      "-o",
      `${denoDir}/warm-up.js`,
      stub,
    ],
    env: { DENO_DIR: denoDir },
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!warmUp.success) {
    console.error(
      `warm-up deno bundle failed:\n${new TextDecoder().decode(warmUp.stderr)}`,
    );
  }
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "test",
      "--allow-all",
      "--permit-no-files",
      "--parallel",
      "tests/**/*_slow_test.ts",
      ...Deno.args,
    ],
    env: { DENO_DIR: denoDir },
  }).spawn();
  code = (await child.status).code;
} finally {
  Deno.removeSync(denoDir, { recursive: true });
}
Deno.exit(code);
