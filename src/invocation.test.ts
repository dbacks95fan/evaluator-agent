// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Unit tests for admitting an Evaluation StageInvocation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { admitEvaluation, BlockedError, identityOf } from "./invocation.js";
import { parseManifest } from "./manifest.js";
import { INTENT_REPO, sampleInvocation, TARGET_REPO } from "./testFixtures.js";
import type { StageInvocation } from "./types.js";

const manifest = parseManifest({
  repositories: [{ url: TARGET_REPO, setup: [], checks: { build: "npm run build" } }],
  intent_repositories: [INTENT_REPO],
});

function blockedReasons(invocation: unknown): string {
  try {
    admitEvaluation(invocation, manifest);
  } catch (err) {
    assert.ok(err instanceof BlockedError);
    return err.reasons.join(" ");
  }
  assert.fail("expected the invocation to be blocked");
}

test("a well-formed evaluation invocation is admitted with its inputs classified", () => {
  const admitted = admitEvaluation(sampleInvocation(), manifest);
  assert.equal(admitted.branch, "work/INT-MF-0042");
  assert.equal(admitted.spec.path, ".agent/work/INT-MF-0042/spec.md");
  assert.equal(admitted.workContract.path, ".agent/work/INT-MF-0042/work-contract.yaml");
  assert.equal(admitted.evidence.path, ".agent/work/INT-MF-0042/evidence-package/inv-0.json");
  assert.equal(admitted.packagePath, ".agent/work/INT-MF-0042/evaluation-package/inv-1.json");
  assert.equal(admitted.frozenIntentPath, ".agent/work/INT-MF-0042/intent.md");
});

test("a schema-invalid record is blocked", () => {
  assert.match(blockedReasons({ ...sampleInvocation(), schema_version: "1.0" }), /not a valid 1.1 record/);
});

test("another stage is blocked", () => {
  assert.match(blockedReasons({ ...sampleInvocation(), stage: "execution" }), /evaluation stage/);
});

test("a work item that differs from the freeze is blocked", () => {
  const invocation = sampleInvocation();
  invocation.work_item = { ...invocation.work_item, intent_version: 2 };
  assert.match(blockedReasons(invocation), /does not match the work item of its freeze/);
});

test("a workspace_ref other than the assigned work branch is blocked", () => {
  assert.match(blockedReasons({ ...sampleInvocation(), workspace_ref: "main" }), /assigned work branch/);
});

test("an untrusted target or intent repository is blocked", () => {
  const invocation: StageInvocation = sampleInvocation();
  invocation.target = { ...invocation.target, repository: "https://github.com/evil/repo.git" };
  invocation.freeze_activation.intent = {
    ...invocation.freeze_activation.intent,
    repository: "https://github.com/evil/intents.git",
  };
  const reasons = blockedReasons(invocation);
  assert.match(reasons, /not in the trusted manifest/);
  assert.match(reasons, /not an allowed intent repository/);
});

test("missing, duplicate, or unrecognized inputs are blocked", () => {
  const invocation = sampleInvocation();
  const [spec, , evidence] = invocation.input_artifacts;
  invocation.input_artifacts = [spec, spec, { ...evidence, path: "notes/extra.md" }];
  const reasons = blockedReasons(invocation);
  assert.match(reasons, /More than one spec.md/);
  assert.match(reasons, /not a recognized Evaluation input/);
  assert.match(reasons, /work-contract.yaml input is missing/);
  assert.match(reasons, /Evidence Package|evidence-package\/<name>.json input is missing/);
});

test("an input from another repository is blocked", () => {
  const invocation = sampleInvocation();
  invocation.input_artifacts[0] = { ...invocation.input_artifacts[0], repository: "https://github.com/x/y.git" };
  assert.match(blockedReasons(invocation), /spec.md is not in the target repository/);
});

test("write_paths that do not cover the Evaluation Package path are blocked", () => {
  const reasons = blockedReasons({ ...sampleInvocation(), write_paths: ["../escape", "src"] });
  assert.match(reasons, /write_paths: Path scope "..\/escape"/);
  assert.match(reasons, /does not authorize the Evaluation Package path/);
});

test("identityOf recovers correlation identity from a partly valid record", () => {
  const invocation = sampleInvocation();
  assert.deepEqual(identityOf({ invocation_id: "inv-9", work_item: invocation.work_item, stage: "execution" }), {
    invocationId: "inv-9",
    workItem: invocation.work_item,
    stage: "execution",
  });
  assert.equal(
    identityOf({ invocation_id: "inv-9", work_item: invocation.work_item, stage: "bogus" })?.stage,
    "evaluation",
  );
  assert.equal(identityOf({ invocation_id: "inv-9" }), null);
  assert.equal(identityOf("not an object"), null);
});
