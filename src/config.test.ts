// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Unit tests for environment configuration.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_MODEL, loadConfig, secretValues } from "./config.js";
import { removeDir, tempDir } from "./testSupport.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/** Runs a test with a key file on disk and the three GitHub App settings pointing at it. */
function withAppSettings(body: (env: NodeJS.ProcessEnv, keyFile: string) => void, keyText = privateKey): void {
  const dir = tempDir("config-");
  try {
    const keyFile = join(dir, "app.pem");
    writeFileSync(keyFile, keyText);
    body(
      {
        EVALUATOR_GITHUB_APP_ID: "5555873",
        EVALUATOR_GITHUB_APP_INSTALLATION_ID: "177232772",
        EVALUATOR_GITHUB_APP_PRIVATE_KEY_FILE: keyFile,
      },
      keyFile,
    );
  } finally {
    removeDir(dir);
  }
}

test("defaults use the current Codex model with bounded limits and no reasoning override", () => {
  const config = loadConfig({});
  assert.equal(config.model, DEFAULT_MODEL);
  assert.equal(DEFAULT_MODEL, "gpt-6.1-sol");
  assert.equal(config.reasoningEffort, undefined);
  assert.equal(config.limits.maxTurns, 40);
  assert.equal(config.limits.maxRuntimeMs, 30 * 60_000);
  assert.equal(config.port, 8080);
  assert.equal(config.manifestPath, "/config/manifest.json");
});

test("model, effort, and limits can be overridden; non-positive limits are rejected", () => {
  const config = loadConfig({
    EVALUATOR_MODEL: "gpt-6-sol",
    EVALUATOR_REASONING_EFFORT: "high",
    EVALUATOR_MAX_TURNS: "9",
  });
  assert.equal(config.model, "gpt-6-sol");
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.limits.maxTurns, 9);
  assert.throws(() => loadConfig({ EVALUATOR_MAX_TURNS: "0" }), /EVALUATOR_MAX_TURNS/);
  assert.throws(() => loadConfig({ EVALUATOR_CHECK_TIMEOUT_MIN: "abc" }), /EVALUATOR_CHECK_TIMEOUT_MIN/);
});

test("prefixed variables become command environment without the prefix", () => {
  const config = loadConfig({ EVALUATOR_COMMAND_ENV_npm_config_cache: "/cache/npm" });
  assert.deepEqual(config.commandEnv, { npm_config_cache: "/cache/npm" });
});

test("secretValues lists every configured credential, including the GitHub App key", () => {
  withAppSettings((appEnv) => {
    const config = loadConfig({
      ...appEnv,
      OPENAI_API_KEY: "sk-proj-key-123456",
      EVALUATOR_API_TOKEN: "service-token-123",
    });
    assert.deepEqual(secretValues(config).sort(), [privateKey, "service-token-123", "sk-proj-key-123456"].sort());
  });
});

test("loads the GitHub App settings and its private key", () => {
  withAppSettings((appEnv) => {
    const app = loadConfig(appEnv).githubApp;
    assert.equal(app?.appId, "5555873");
    assert.equal(app?.installationId, "177232772");
    assert.equal(app?.privateKey, privateKey);
    assert.equal(app?.apiUrl, "https://api.github.com");
  });
});

test("names the missing GitHub App settings when only some are present", () => {
  assert.throws(
    () => loadConfig({ EVALUATOR_GITHUB_APP_ID: "5555873" }),
    /also set EVALUATOR_GITHUB_APP_INSTALLATION_ID, EVALUATOR_GITHUB_APP_PRIVATE_KEY_FILE/,
  );
});

test("reports an unreadable or unusable key file by path, never by content", () => {
  withAppSettings((appEnv, keyFile) => {
    assert.throws(
      () => loadConfig({ ...appEnv, EVALUATOR_GITHUB_APP_PRIVATE_KEY_FILE: `${keyFile}.missing` }),
      /Cannot read the GitHub App private key file .*\.missing \(ENOENT\)/,
    );
  });
  withAppSettings((appEnv) => {
    assert.throws(
      () => loadConfig(appEnv),
      (err: Error) => /does not hold a usable private key/.test(err.message) && !err.message.includes("not-a-key"),
    );
  }, "-----BEGIN RSA PRIVATE KEY-----\nnot-a-key\n-----END RSA PRIVATE KEY-----\n");
});

test("refuses settings from the earlier Codex CLI build, naming what replaced them", () => {
  assert.throws(
    () => loadConfig({ EVALUATOR_ALLOWED_REPOSITORY_URLS: "https://github.com/x/y.git" }),
    /EVALUATOR_ALLOWED_REPOSITORY_URLS is no longer used.*manifest/,
  );
  assert.throws(() => loadConfig({ CODEX_HOME: "/home/evaluator/.codex" }), /CODEX_HOME is no longer used/);
});
