// Process checks of the installed-extension smoke command with executable test doubles
// for the packaging step and for VS Code.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { withTemporaryDirectory } from "./process_helpers.ts";

const repository = dirname(dirname(fromFileUrl(import.meta.url)));

const cases = [
  {
    mode: "pass",
    code: 0,
    stream: "stdout",
    message: "Installed VSIX restart: passed (editor features: true).",
  },
  {
    mode: "install",
    code: 1,
    stream: "stderr",
    message: "install probe failure",
  },
] as const;

for (const scenario of cases) {
  Deno.test({
    name: `installed smoke command handles ${scenario.mode}`,
    // The executable double uses a POSIX shebang.
    ignore: Deno.build.os === "windows",
    async fn() {
      await withTemporaryDirectory(
        "effektive-smoke-command-",
        async (root) => {
          for (
            const path of [
              "scripts",
              "editors/vscode/test",
              "Contents/Resources/app/bin",
              "Contents/MacOS",
            ]
          ) {
            Deno.mkdirSync(join(root, path), { recursive: true });
          }
          for (const file of ["package_vscode_smoke.ts", "lib.ts"]) {
            Deno.copyFileSync(
              join(repository, "scripts", file),
              join(root, "scripts", file),
            );
          }
          Deno.writeTextFileSync(
            join(root, "scripts/package.ts"),
            "export function packageRelease(out: string): Promise<string[]> {\n  return Promise.resolve([`${out}/a`, `${out}/b`, `${out}/c`]);\n}\n",
          );
          Deno.writeTextFileSync(
            join(root, "editors/vscode/test/installed.js"),
            "// The editor double does not run this file.\n",
          );
          const editor = `#!/bin/sh
for argument in "$@"; do
  if [ "$argument" = "--install-extension" ]; then
    if [ "$SMOKE_TEST_MODE" = "install" ]; then
      echo "install probe failure" >&2
      exit 1
    fi
    exit 0
  fi
done
printf '{"ok":true}' > "$EFFEKTIVE_TEST_RESULT"
exit 0
`;
          for (
            const path of [
              "Contents/Resources/app/bin/code",
              "Contents/MacOS/Code",
            ]
          ) {
            Deno.writeTextFileSync(join(root, path), editor);
            Deno.chmodSync(join(root, path), 0o755);
          }
          const output = await new Deno.Command(Deno.execPath(), {
            args: [
              "run",
              "--no-check",
              "--allow-all",
              "--config",
              join(repository, "deno.json"),
              join(root, "scripts/package_vscode_smoke.ts"),
            ],
            cwd: root,
            env: {
              EFFEKTIVE_VSCODE_EXECUTABLE: join(
                root,
                "Contents/Resources/app/bin/code",
              ),
              SMOKE_TEST_MODE: scenario.mode,
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
