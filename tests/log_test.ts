import { assert, assertEquals } from "@std/assert";
import {
  BUILD,
  type LogEntry,
  type LogFs,
  memoryLog,
  noLog,
  openFileLog,
  prepareLogFolder,
} from "../src/host/log.ts";
import { sha256Hex } from "../src/core/mod.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

/** A memory LogFs. `failWrites` turns every write into a failure. */
function memoryFs(): LogFs & {
  files: Map<string, { text: string; mtimeMs: number }>;
  touched: string[];
  failWrites: boolean;
} {
  const files = new Map<string, { text: string; mtimeMs: number }>();
  const touched: string[] = [];
  const fail = { message: "disk full" };
  const fs = {
    files,
    touched,
    failWrites: false,
    mkdir: () => ({ ok: true as const, value: undefined }),
    writeText(path: string, text: string) {
      if (fs.failWrites) return { ok: false as const, error: fail };
      files.set(path, { text, mtimeMs: NOW });
      return { ok: true as const, value: undefined };
    },
    appendText(path: string, text: string) {
      if (fs.failWrites) return { ok: false as const, error: fail };
      const old = files.get(path);
      files.set(path, { text: (old?.text ?? "") + text, mtimeMs: NOW });
      return { ok: true as const, value: undefined };
    },
    exists: (path: string) => files.has(path),
    list(path: string) {
      const entries: LogEntry[] = [];
      for (const [name, file] of files) {
        const rest = name.startsWith(`${path}/`)
          ? name.slice(path.length + 1)
          : "";
        if (rest !== "" && !rest.includes("/")) {
          entries.push({ name: rest, mtimeMs: file.mtimeMs });
        }
      }
      return { ok: true as const, value: entries };
    },
    touch(path: string) {
      touched.push(path);
      const file = files.get(path);
      if (file) file.mtimeMs = NOW;
      return { ok: true as const, value: undefined };
    },
    remove(path: string) {
      files.delete(path);
      return { ok: true as const, value: undefined };
    },
  };
  return fs;
}

function open(fs: LogFs, session = "s1") {
  let tick = 0;
  const result = openFileLog({
    fs,
    projectDir: "/p",
    surface: "cli",
    now: () => new Date(NOW),
    clock: () => 1000 + (tick += 5),
    session,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const SESSION_FILE = "/p/.effektive/logs/cli-20261026-s1.jsonl";

Deno.test("the file log writes envelopes in order with a growing seq", () => {
  const fs = memoryFs();
  const log = open(fs);
  log.append("a", { x: 1 });
  log.append("b", null);
  const lines = fs.files.get(SESSION_FILE)!.text.split("\n");
  assertEquals(lines.length, 3);
  assertEquals(lines[2], "");
  assertEquals(
    lines[0],
    `{"v":1,"t":"2026-10-26T12:00:00.000Z","ms":5,"surface":"cli","session":"s1","seq":0,"build":"${BUILD}","kind":"a","data":{"x":1}}`,
  );
  const second = JSON.parse(lines[1]);
  assertEquals([second.seq, second.ms, second.kind], [1, 10, "b"]);
});

Deno.test("the log folder gets a self-ignoring .gitignore", () => {
  const fs = memoryFs();
  open(fs);
  assertEquals(fs.files.get("/p/.effektive/.gitignore")?.text, "*\n");
});

Deno.test("a blob is written once, and touched when it is used again", () => {
  const fs = memoryFs();
  const log = open(fs);
  const hash = log.blob("hello");
  assertEquals(hash, sha256Hex("hello"));
  const path = `/p/.effektive/logs/blobs/${hash}.txt`;
  assertEquals(fs.files.get(path)?.text, "hello");
  assertEquals(fs.touched, []);
  assertEquals(log.blob("hello"), hash);
  assertEquals(fs.touched, [path]);
});

Deno.test("rotation removes old session files and blobs, and keeps recent ones", () => {
  const fs = memoryFs();
  const put = (path: string, ageDays: number) =>
    fs.files.set(path, { text: "", mtimeMs: NOW - ageDays * DAY });
  put("/p/.effektive/logs/cli-old.jsonl", 8);
  put("/p/.effektive/logs/cli-new.jsonl", 6);
  put("/p/.effektive/logs/blobs/old.txt", 8);
  put("/p/.effektive/logs/blobs/new.txt", 6);
  put("/p/.effektive/logs/notes.md", 30);
  open(fs);
  assertEquals(
    [...fs.files.keys()].filter((k) => k !== "/p/.effektive/.gitignore")
      .sort(),
    [
      "/p/.effektive/logs/blobs/new.txt",
      "/p/.effektive/logs/cli-new.jsonl",
      "/p/.effektive/logs/notes.md",
    ],
  );
});

Deno.test("a write failure turns the log off without throwing", () => {
  const fs = memoryFs();
  const log = open(fs);
  log.append("a", 1);
  fs.failWrites = true;
  log.append("b", 2);
  fs.failWrites = false;
  log.append("c", 3);
  assertEquals(fs.files.get(SESSION_FILE)!.text.split("\n").length, 2);
  assertEquals(log.blob("x"), sha256Hex("x"));
  assertEquals(fs.files.size, 2);
});

Deno.test("unserializable data turns the log off without throwing", () => {
  const fs = memoryFs();
  const log = open(fs);
  log.append("a", 1n);
  log.append("b", 2);
  assertEquals(fs.files.has(SESSION_FILE), false);
});

Deno.test("noLog does nothing and memoryLog records", () => {
  noLog.append("a", 1);
  assertEquals(noLog.blob("t"), sha256Hex("t"));
  let tick = 0;
  const log = memoryLog("lsp", {
    now: () => new Date(NOW),
    clock: () => tick += 1,
    session: "m",
    build: "9.9.9",
  });
  log.append("k", { y: 2 });
  log.append("k2", null);
  const hash = log.blob("t");
  assertEquals(log.blobs.get(hash), "t");
  assertEquals(log.events[1], {
    v: 1,
    t: "2026-10-26T12:00:00.000Z",
    ms: 2,
    surface: "lsp",
    session: "m",
    seq: 1,
    build: "9.9.9",
    kind: "k2",
    data: null,
  });
  assert(BUILD.length > 0);
});

Deno.test("prepareLogFolder gives the logs folder and passes on a mkdir failure", () => {
  const fs = memoryFs();
  const prepared = prepareLogFolder(fs, "/p", new Date(NOW));
  assertEquals(prepared, { ok: true, value: "/p/.effektive/logs" });
  assertEquals(fs.files.get("/p/.effektive/.gitignore")?.text, "*\n");
  const failure = { message: "denied" };
  const failing = {
    ...fs,
    mkdir: () => ({ ok: false as const, error: failure }),
  };
  assertEquals(prepareLogFolder(failing, "/p", new Date(NOW)), {
    ok: false,
    error: failure,
  });
});
