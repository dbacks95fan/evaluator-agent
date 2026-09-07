// ABOUTME: Defines regression coverage for the environment inherited by Codex child processes.
// ABOUTME: The evaluator must preserve its stateless writable home because Codex rejects helper files under /tmp.
import assert from "node:assert/strict";
import test from "node:test";
import { codexExecutionEnvironment } from "./codex-runtime.js";

test("preserves the configured stateless Codex home for child processes", () => {
  const environment = codexExecutionEnvironment({
    HOME: "/home/evaluator",
    CODEX_HOME: "/home/evaluator/.codex",
    OPENAI_API_KEY: "test-key",
  });

  assert.equal(environment.HOME, "/home/evaluator");
  assert.equal(environment.CODEX_HOME, "/home/evaluator/.codex");
  assert.equal(environment.OPENAI_API_KEY, "test-key");
});
