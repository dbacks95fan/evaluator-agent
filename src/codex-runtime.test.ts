// ABOUTME: Defines regression coverage for the environment inherited by Codex child processes.
// ABOUTME: The evaluator must preserve its stateless writable home because Codex rejects helper files under /tmp.
import assert from "node:assert/strict";
import test from "node:test";
import { codexExecutionEnvironment, codexFailureMessage } from "./codex-runtime.js";

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

test("includes Codex JSON-stream diagnostics when an execution fails", () => {
  const message = codexFailureMessage(1, '{"type":"error","message":"schema rejected"}', "Reading additional input from stdin...");

  assert.match(message, /exited 1/);
  assert.match(message, /schema rejected/);
  assert.match(message, /Reading additional input/);
});
