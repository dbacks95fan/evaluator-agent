// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Verifies the reviewer's read-only tools stay inside the checkout, never expose .git, and cap output.
import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { runReadTool, type ReadToolContext } from "./readTools.js";
import { removeDir, tempDir, writeBytes } from "./testSupport.js";

let root: string;
let ctx: ReadToolContext;
const diffs: (string | null)[] = [];

before(() => {
  root = tempDir("tools-");
  const workspace = join(root, "repo");
  writeBytes(workspace, "src/app.ts", "export const plan = 'Weekly Plan';\n");
  writeBytes(workspace, "README.md", "# Product\n");
  writeBytes(workspace, ".git/config", "[core]\n");
  writeBytes(workspace, "node_modules/dep/index.js", "weekly plan in a dependency\n");
  writeFileSync(join(workspace, "image.bin"), Buffer.from([0x89, 0x50, 0x00, 0x00]));
  writeBytes(root, "outside.txt", "outside\n");
  ctx = {
    workspace,
    maxOutputChars: 10_000,
    diff: async (path) => {
      diffs.push(path);
      return path ? `diff for ${path}` : "";
    },
  };
});

after(() => removeDir(root));

const call = (name: string, args: unknown) => runReadTool(ctx, name, JSON.stringify(args));

test("lists a directory without .git", async () => {
  assert.equal(await call("list_directory", { path: "." }), "README.md\nimage.bin\nnode_modules/\nsrc/");
});

test("reads a file and pages through it by byte offset", async () => {
  assert.equal(await call("read_file", { path: "src/app.ts", offset: null }), "export const plan = 'Weekly Plan';\n");
  assert.equal(await call("read_file", { path: "src/app.ts", offset: 7 }), "const plan = 'Weekly Plan';\n");
});

test("search is case-insensitive and skips dependency folders", async () => {
  assert.equal(
    await call("search_files", { text: "weekly plan", path: null }),
    "src/app.ts:1: export const plan = 'Weekly Plan';",
  );
});

test("show_diff passes a confined path or null to the diff function", async () => {
  assert.equal(await call("show_diff", { path: "src/app.ts" }), "diff for src/app.ts");
  assert.equal(await call("show_diff", { path: null }), "(no differences)");
  assert.deepEqual(diffs.slice(-2), ["src/app.ts", null]);
  assert.match(await call("show_diff", { path: "../outside.txt" }), /^error: .*outside the assigned workspace/);
});

test("refusals come back as error text", async () => {
  const cases: [string, unknown, RegExp][] = [
    ["read_file", { path: "../outside.txt", offset: null }, /outside the assigned workspace/],
    ["read_file", { path: ".git/config", offset: null }, /\.git directory is not readable/],
    ["list_directory", { path: ".git" }, /\.git directory is not readable/],
    ["read_file", { path: "image.bin", offset: null }, /looks binary/],
    ["read_file", { path: "src", offset: null }, /is not a file/],
    ["read_file", { path: "src/app.ts", offset: -1 }, /non-negative integer/],
    ["search_files", { text: "", path: null }, /non-empty/],
    ["write_file", { path: "x" }, /unknown tool/],
  ];
  for (const [name, args, pattern] of cases) {
    const result = await call(name, args);
    assert.ok(result.startsWith("error: ") && pattern.test(result), `${name} ${JSON.stringify(args)} -> ${result}`);
  }
  assert.equal(await runReadTool(ctx, "read_file", "{not json"), "error: arguments were not valid JSON");
  assert.equal(await runReadTool(ctx, "read_file", "[1]"), "error: arguments must be a JSON object");
});

test("a symlink pointing out of the checkout is refused", async (t) => {
  try {
    symlinkSync(join(root, "outside.txt"), join(ctx.workspace, "link.txt"));
  } catch {
    t.skip("this platform does not allow creating symlinks here");
    return;
  }
  assert.match(await call("read_file", { path: "link.txt", offset: null }), /outside the assigned workspace/);
});
