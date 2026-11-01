// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Tests for the command-line entry point's argument handling and failure modes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function cli(args: string[], env: Record<string, string> = {}) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, EVALUATOR_WORK_ROOT: join(tmpdir(), "evaluator-cli-test") };
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.EVALUATOR_API_TOKEN;
  Object.assign(childEnv, env);
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: childEnv });
}

test("an unknown command prints usage and exits 64", () => {
  const result = cli(["review", "--contract", "x"]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /Usage:/);
});

test("serve refuses to start without a model key and says why", () => {
  const result = cli(["serve"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OPENAI_API_KEY is not set/);
});

test("serve refuses to run unauthenticated", () => {
  const result = cli(["serve"], { OPENAI_API_KEY: "sk-proj-placeholder-for-test" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EVALUATOR_API_TOKEN is not set/);
});

test("invalid configuration is reported clearly", () => {
  const result = cli(["self-test"], { EVALUATOR_MAX_TURNS: "0" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EVALUATOR_MAX_TURNS/);
});
