// Process checks of the rules:unfired command with a small executable test double.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { withTemporaryDirectory } from "./process_helpers.ts";

const repository = dirname(dirname(fromFileUrl(import.meta.url)));

const cases = [
  {
    mode: "pass",
    code: 0,
    stream: "stdout",
    message: "0 unfired rejection sites",
  },
  {
    mode: "test",
    code: 1,
    stream: "stderr",
    message: "rules:unfired: the fast suite failed",
  },
  {
    mode: "coverage",
    code: 1,
    stream: "stderr",
    message: "rules:unfired: deno coverage failed",
  },
] as const;

for (const scenario of cases) {
  Deno.test({
    name: `rules:unfired command handles ${scenario.mode}`,
    // The executable double uses a POSIX shebang.
    ignore: Deno.build.os === "windows",
    async fn() {
      await withTemporaryDirectory(
        "effektive-rules-unfired-command-",
        async (root) => {
          Deno.mkdirSync(join(root, "scripts"), { recursive: true });
          Deno.mkdirSync(join(root, "bin"));
          for (const file of ["rules_unfired.ts", "lib.ts"]) {
            Deno.copyFileSync(
              join(repository, "scripts", file),
              join(root, "scripts", file),
            );
          }
          const executable = join(root, "bin/deno");
          Deno.writeTextFileSync(
            executable,
            `#!/bin/sh
if [ "$1" = "$RULES_UNFIRED_FAIL" ]; then
  echo "probe failure" >&2
  exit 1
fi
exit 0
`,
          );
          Deno.chmodSync(executable, 0o755);
          const output = await new Deno.Command(Deno.execPath(), {
            args: [
              "run",
              "--no-check",
              "--allow-read",
              "--allow-write",
              "--allow-run",
              "--config",
              join(repository, "deno.json"),
              join(root, "scripts/rules_unfired.ts"),
            ],
            cwd: root,
            env: {
              PATH: `${join(root, "bin")}:${Deno.env.get("PATH") ?? ""}`,
              RULES_UNFIRED_FAIL: scenario.mode === "pass"
                ? "none"
                : scenario.mode,
              NO_COLOR: "1",
            },
            stdout: "piped",
            stderr: "piped",
          }).output();
          const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
          assertEquals(
            output.code,
            scenario.code,
            `${text(output.stdout)}\n${text(output.stderr)}`,
          );
          assertStringIncludes(
            text(scenario.stream === "stdout" ? output.stdout : output.stderr),
            scenario.message,
          );
        },
      );
    },
  });
}
