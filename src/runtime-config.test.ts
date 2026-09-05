// ABOUTME: Verifies evaluator runtime configuration that cannot be covered by the pure TypeScript validation tests.
// ABOUTME: These checks prevent deployment-only Codex failures from returning after image or Compose changes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const composePath = fileURLToPath(new URL("../compose.yaml", import.meta.url));
const canarySchemaPath = fileURLToPath(new URL("../schemas/codex-auth-canary.schema.json", import.meta.url));

test("starts the evaluator with a temporary Codex API-key session", async () => {
  const compose = parse(await readFile(composePath, "utf8")) as { services: { evaluator: { command?: string | string[]; environment?: Record<string, string> } } };
  const command = Array.isArray(compose.services.evaluator.command) ? compose.services.evaluator.command.join(" ") : compose.services.evaluator.command ?? "";

  assert.equal(compose.services.evaluator.environment?.HOME, "/tmp");
  assert.match(command, /mkdir -p "\$\$CODEX_HOME"/);
  assert.match(command, /codex login --with-api-key/);
});

test("declares the canary status as a string for the Responses API", async () => {
  const schema = JSON.parse(await readFile(canarySchemaPath, "utf8")) as { properties: { status: unknown } };

  assert.deepEqual(schema.properties.status, { type: "string", const: "authenticated" });
});
