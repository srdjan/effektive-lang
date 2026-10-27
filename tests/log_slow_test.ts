import { assert, assertEquals } from "@std/assert";
import { denoLogFs } from "../src/host/deno_io.ts";
import { openFileLog } from "../src/host/log.ts";
import { sha256Hex } from "../src/core/mod.ts";

Deno.test("the file log works on the real disk", () => {
  const dir = Deno.makeTempDirSync({ prefix: "effektive-log-" });
  try {
    const logs = `${dir}/.effektive/logs`;
    Deno.mkdirSync(`${logs}/blobs`, { recursive: true });
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    for (const path of [`${logs}/cli-old.jsonl`, `${logs}/blobs/old.txt`]) {
      Deno.writeTextFileSync(path, "x");
      Deno.utimeSync(path, old, old);
    }
    const retainedHash = sha256Hex("retained source");
    const retainedBlob = `${logs}/blobs/${retainedHash}.txt`;
    Deno.writeTextFileSync(retainedBlob, "retained source");
    Deno.utimeSync(retainedBlob, old, old);
    Deno.writeTextFileSync(
      `${logs}/cli-recent.jsonl`,
      JSON.stringify({ data: { hash: retainedHash } }) + "\n",
    );

    const opened = openFileLog({
      fs: denoLogFs,
      projectDir: dir,
      surface: "cli",
      session: "abc",
    });
    assert(opened.ok);
    const log = opened.value;
    log.append("one", { n: 1 });
    log.append("two", [2]);
    const hash = log.blob("source text");
    assertEquals(hash, sha256Hex("source text"));
    assertEquals(log.blob("source text"), hash);

    assertEquals(Deno.readTextFileSync(`${dir}/.effektive/.gitignore`), "*\n");
    assertEquals(
      Deno.readTextFileSync(`${logs}/blobs/${hash}.txt`),
      "source text",
    );
    const names = [...Deno.readDirSync(logs)].map((e) => e.name);
    assert(!names.includes("cli-old.jsonl"));
    assert(names.includes("cli-recent.jsonl"));
    assert(!Deno.statSync(`${logs}/blobs`).isFile);
    assertEquals(
      [...Deno.readDirSync(`${logs}/blobs`)].map((e) => e.name).sort(),
      [`${hash}.txt`, `${retainedHash}.txt`].sort(),
    );
    assertEquals(Deno.readTextFileSync(retainedBlob), "retained source");
    const session = names.find((n) => n.endsWith("-abc.jsonl"));
    assert(session !== undefined);
    const lines = Deno.readTextFileSync(`${logs}/${session}`).trimEnd().split(
      "\n",
    ).map((l) => JSON.parse(l));
    assertEquals(lines.map((l) => [l.seq, l.kind]), [[0, "one"], [1, "two"]]);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
