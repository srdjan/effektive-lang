// Process checks of the coverage command with a small executable test double.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { productionSourcePaths } from "../scripts/coverage.ts";
import { withTemporaryDirectory } from "./process_helpers.ts";

const repository = dirname(dirname(fromFileUrl(import.meta.url)));

for (
  const [linkedEntry, directory] of [
    ["file", "src/nested"],
    ["directory", "playground/src"],
  ] as const
) {
  Deno.test({
    name: `coverage inventory rejects a symbolic-link ${linkedEntry}`,
    ignore: Deno.build.os === "windows",
    async fn() {
      await withTemporaryDirectory(
        "effektive-coverage-inventory-",
        async (root) => {
          Deno.mkdirSync(join(root, "src"), { recursive: true });
          Deno.mkdirSync(join(root, "playground/src"), { recursive: true });
          const target = join(root, `linked-${linkedEntry}`);
          const linkName = linkedEntry === "file"
            ? "linked-file.ts"
            : "linked-directory";
          const link = join(root, directory, linkName);
          Deno.mkdirSync(dirname(link), { recursive: true });
          if (linkedEntry === "file") {
            Deno.writeTextFileSync(target, "export const linked = true;\n");
          } else {
            Deno.mkdirSync(target);
            Deno.writeTextFileSync(
              join(target, "nested.ts"),
              "export const linked = true;\n",
            );
          }
          Deno.symlinkSync(target, link);

          const result = await productionSourcePaths(root);

          assertEquals(result.ok, false);
          if (!result.ok) {
            assertEquals(result.error.tag, "inventory");
            assertStringIncludes(
              result.error.message,
              `${directory}/${linkName}`,
            );
            assertStringIncludes(result.error.message, "symbolic link");
          }
        },
      );
    },
  });
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const cases = [
  { mode: "pass", code: 0, message: "Total: lines 100.00%" },
  { mode: "test", code: 1, message: "the fast suite failed" },
  { mode: "run", code: 1, message: "the slow suite failed" },
  { mode: "failed", code: 1, message: "deno coverage failed" },
  { mode: "empty", code: 1, message: "deno coverage failed" },
  { mode: "incomplete", code: 1, message: "invalid LCOV report" },
  { mode: "floor", code: 1, message: "Coverage threshold not met" },
  { mode: "inventory", code: 1, message: "unclassified source files" },
  { mode: "manifest", code: 1, message: "cannot read coverage ownership" },
  { mode: "sources", code: 1, message: "cannot read production sources" },
] as const;

for (const scenario of cases) {
  Deno.test({
    name: `coverage command handles ${scenario.mode}`,
    // The executable double uses a POSIX shebang. Native Windows coverage
    // remains a separate acceptance check.
    ignore: Deno.build.os === "windows",
    async fn() {
      await withTemporaryDirectory(
        "effektive-coverage-command-",
        async (root) => {
          for (
            const path of [
              "scripts",
              "src/core",
              "playground/src",
              "fixtures/coverage",
              "bin",
            ]
          ) {
            Deno.mkdirSync(join(root, path), { recursive: true });
          }
          Deno.copyFileSync(
            join(repository, "scripts/coverage.ts"),
            join(root, "scripts/coverage.ts"),
          );
          Deno.writeTextFileSync(join(root, "src/core/mod.ts"), "export {};\n");
          const category = (paths: readonly string[]) => ({
            paths,
            reason: "The command probe owns this temporary source.",
            owner: "coverage command probe",
          });
          Deno.writeTextFileSync(
            join(root, "fixtures/coverage/ownership.json"),
            JSON.stringify({
              runtimeReportable: category(
                scenario.mode === "inventory" ? [] : ["src/core/mod.ts"],
              ),
              typeOnly: category([]),
              separatelyExercisedEntrypoint: category([]),
            }),
          );
          if (scenario.mode === "manifest") {
            Deno.removeSync(join(root, "fixtures/coverage/ownership.json"));
          }
          if (scenario.mode === "sources") {
            Deno.removeSync(join(root, "src"), { recursive: true });
          }
          const record = [
            `SF:${join(root, "src/core/mod.ts")}`,
            "FNF:0",
            "FNH:0",
            "BRF:0",
            "BRH:0",
            "LF:1",
            "LH:1",
            "end_of_record",
          ].join("\n");
          const child = join(root, "child.ts");
          Deno.writeTextFileSync(
            child,
            `
const mode = Deno.env.get("COVERAGE_TEST_MODE");
const stage = Deno.args[0];
if (mode === stage) {
  console.error("probe failure");
  Deno.exit(1);
}
if (stage === "coverage") {
  const report = Deno.env.get("COVERAGE_TEST_REPORT") ?? "";
  console.log(mode === "empty" ? "" : mode === "incomplete" ? "SF:missing" : report);
  if (mode === "failed" || mode === "floor") {
    console.error(mode === "floor" ? "Coverage threshold not met" : "probe report failure");
    Deno.exit(1);
  }
}
`,
          );
          const executable = join(root, "bin/deno");
          Deno.writeTextFileSync(
            executable,
            `#!/bin/sh\nexec ${
              shellArgument(Deno.execPath())
            } run --no-config --allow-env ${shellArgument(child)} "$@"\n`,
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
              join(root, "scripts/coverage.ts"),
            ],
            cwd: root,
            env: {
              PATH: `${join(root, "bin")}:${Deno.env.get("PATH") ?? ""}`,
              COVERAGE_TEST_MODE: scenario.mode,
              COVERAGE_TEST_REPORT: record,
              NO_COLOR: "1",
            },
            stdout: "piped",
            stderr: "piped",
          }).output();
          const stdout = new TextDecoder().decode(output.stdout);
          const stderr = new TextDecoder().decode(output.stderr);
          assertEquals(output.code, scenario.code, `${stdout}\n${stderr}`);
          assertStringIncludes(
            scenario.code === 0 ? stdout : stderr,
            scenario.message,
          );
        },
      );
    },
  });
}
