// ABOUTME: Defines integration coverage for temporary Git checkouts used by remote evaluations.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkoutEvaluationRevision, publishEvaluationPackage } from "./gitCheckout.js";

test("checks out the candidate and publishes only the assigned Evaluation Package", async () => {
  const source = await mkdtemp(join(tmpdir(), "evaluator-source-"));
  const remote = await mkdtemp(join(tmpdir(), "evaluator-remote-"));
  const remotePath = join(remote, "product.git");
  try {
    execFileSync("git", ["-c", "init.defaultBranch=main", "init"], { cwd: source });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: source });
    execFileSync("git", ["config", "user.name", "Evaluator Test"], { cwd: source });
    await writeFile(join(source, "intent.md"), "# Accepted intent\n", "utf8");
    await writeFile(join(source, "contract.yaml"), "schema_version: 2\n", "utf8");
    execFileSync("git", ["-c", "core.autocrlf=false", "add", "."], { cwd: source });
    execFileSync("git", ["commit", "-m", "accepted inputs"], { cwd: source });
    execFileSync("git", ["switch", "-c", "work/TEST-1"], { cwd: source });
    await writeFile(join(source, "app.txt"), "candidate\n", "utf8");
    execFileSync("git", ["add", "app.txt"], { cwd: source });
    execFileSync("git", ["commit", "-m", "candidate"], { cwd: source });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
    await writeFile(join(source, "evidence.json"), "{}\n", "utf8");
    execFileSync("git", ["add", "evidence.json"], { cwd: source });
    execFileSync("git", ["commit", "-m", "evidence package"], { cwd: source });
    const branchRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
    execFileSync("git", ["init", "--bare", remotePath]);
    execFileSync("git", ["remote", "add", "origin", remotePath], { cwd: source });
    execFileSync("git", ["push", "--set-upstream", "origin", "work/TEST-1"], { cwd: source });

    const checkout = await checkoutEvaluationRevision({
      repositoryUrl: remotePath,
      allowedRepositoryUrls: [remotePath],
      branch: "work/TEST-1",
      revision,
      branchRevision,
      intentPath: "intent.md",
      contractPath: "contract.yaml",
      contractText: "schema_version: 2\n",
      evidencePath: "evidence.json",
      evidenceText: "{}\n",
      githubToken: "test-token",
    });
    try {
      assert.match(checkout.repositoryPath, /evaluator-job-/);
      assert.equal(checkout.intentPath.endsWith("intent.md"), true);
      assert.equal(await readFile(checkout.contractPath, "utf8"), "schema_version: 2\n");
      const published = await publishEvaluationPackage({
        checkout,
        githubToken: "test-token",
        workItem: "TEST-1",
        packagePath: ".agent/work/TEST-1/evaluation-package/evaluation.json",
        packageText: "{\"candidate_revision\":\"" + revision + "\"}\n",
      });
      assert.equal(published.candidateRevision, revision);
      assert.notEqual(published.packageRevision, branchRevision);
      assert.equal(published.path, ".agent/work/TEST-1/evaluation-package/evaluation.json");
      const pushedRevision = execFileSync("git", ["--git-dir", remotePath, "rev-parse", "refs/heads/work/TEST-1"], { encoding: "utf8" }).trim();
      assert.equal(pushedRevision, published.packageRevision);
      assert.notEqual(pushedRevision, revision);
      const changedPaths = execFileSync("git", ["--git-dir", remotePath, "diff-tree", "--no-commit-id", "--name-only", "-r", pushedRevision], { encoding: "utf8" }).trim().split(/\r?\n/);
      assert.deepEqual(changedPaths, [published.path]);
    } finally {
      await checkout.cleanup();
    }
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  }
});

test("rejects an evaluation artifact outside its assigned path", async () => {
  const source = await mkdtemp(join(tmpdir(), "evaluator-source-"));
  const remote = await mkdtemp(join(tmpdir(), "evaluator-remote-"));
  const remotePath = join(remote, "product.git");
  try {
    execFileSync("git", ["-c", "init.defaultBranch=main", "init"], { cwd: source });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: source });
    execFileSync("git", ["config", "user.name", "Evaluator Test"], { cwd: source });
    await writeFile(join(source, "intent.md"), "# Accepted intent\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: source });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: source });
    execFileSync("git", ["switch", "-c", "work/TEST-1"], { cwd: source });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
    execFileSync("git", ["init", "--bare", remotePath]);
    execFileSync("git", ["remote", "add", "origin", remotePath], { cwd: source });
    execFileSync("git", ["push", "--set-upstream", "origin", "work/TEST-1"], { cwd: source });
    const checkout = await checkoutEvaluationRevision({
      repositoryUrl: remotePath, allowedRepositoryUrls: [remotePath], branch: "work/TEST-1", revision, branchRevision: revision,
      intentPath: "intent.md", contractPath: "contract.yaml", contractText: "schema_version: 2\n",
      evidencePath: "evidence.json", evidenceText: "{}\n", githubToken: "test-token",
    });
    try {
      await assert.rejects(publishEvaluationPackage({ checkout, githubToken: "test-token", workItem: "TEST-1", packagePath: "README.md", packageText: "bad\n" }), /Evaluation Package path must be/);
    } finally {
      await checkout.cleanup();
    }
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  }
});
