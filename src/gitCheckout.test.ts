// ABOUTME: Defines integration coverage for temporary Git checkouts used by remote evaluations.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkoutEvaluationRevision } from "./gitCheckout.js";

test("checks out the requested immutable revision and removes the temporary repository", async () => {
  const source = await mkdtemp(join(tmpdir(), "evaluator-source-"));
  try {
    execFileSync("git", ["init"], { cwd: source });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: source });
    execFileSync("git", ["config", "user.name", "Evaluator Test"], { cwd: source });
    await writeFile(join(source, "intent.md"), "# Accepted intent\n", "utf8");
    await writeFile(join(source, "contract.yaml"), "schema_version: 2\n", "utf8");
    await writeFile(join(source, "evidence.json"), "{}\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: source });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: source });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();

    const checkout = await checkoutEvaluationRevision({
      repositoryUrl: source,
      allowedRepositoryUrl: source,
      revision,
      intentPath: "intent.md",
      contractPath: "contract.yaml",
      evidencePath: "evidence.json",
    });
    try {
      assert.match(checkout.repositoryPath, /evaluator-job-/);
      assert.equal(checkout.intentPath.endsWith("intent.md"), true);
    } finally {
      await checkout.cleanup();
    }
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});
