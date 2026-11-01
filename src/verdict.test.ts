// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Unit tests for the evaluation verdict: the review can lower the status but never raise it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Review, ReviewOutcome } from "./review.js";
import { sampleWorkContract, sampleWorkItem, SHA_C, TARGET_REPO } from "./testFixtures.js";
import type { EvidencePackage, ValidationResult } from "./types.js";
import { decide } from "./verdict.js";

const contract = sampleWorkContract();
const passed: ValidationResult[] = [
  { name: "build", outcome: "passed", observed_at: "2026-10-31T10:00:00Z", summary: "exit 0" },
];
const failedCheck: ValidationResult[] = [
  { name: "build", outcome: "failed", observed_at: "2026-10-31T10:00:00Z", summary: "exit 1" },
];
const evidence: EvidencePackage = {
  schema_version: "1.0",
  work_item: sampleWorkItem(),
  input_artifacts: [],
  candidate: { repository: TARGET_REPO, commit_sha: SHA_C },
  changed_paths: [],
  validation: passed,
  policy_control_evidence: [],
  status: "candidate_complete",
};

function outcome(review: Partial<Review> | null, extra: Partial<ReviewOutcome> = {}): ReviewOutcome {
  return {
    review: review
      ? {
          status: "pass",
          summary: "Looks right.",
          acceptance_criteria: [{ index: 0, verdict: "satisfied", evidence: "seen" }],
          findings: [],
          decisions_needed: [],
          ...review,
        }
      : null,
    limitHit: null,
    refused: false,
    turns: 1,
    usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1 },
    durationMs: 1,
    ...extra,
  };
}

test("pass needs every rerun check passed, every criterion satisfied, and nothing blocking", () => {
  const decision = decide({ contract, checks: passed, evidence, review: outcome({}) });
  assert.equal(decision.status, "pass");
  assert.deepEqual(decision.findings, []);
});

test("a failed rerun check turns a passing review into fail, with an evidence note when the claim disagrees", () => {
  const decision = decide({ contract, checks: failedCheck, evidence, review: outcome({}) });
  assert.equal(decision.status, "fail");
  assert.equal(decision.findings[0].category, "implementation");
  assert.equal(decision.findings[0].severity, "blocking");
  assert.match(decision.findings[0].summary, /Required check build failed when the Evaluator reran it/);
  assert.ok(decision.findings.some((f) => f.category === "evidence" && /reported build as passed/.test(f.summary)));
});

test("an unsatisfied criterion becomes a blocking implementation finding", () => {
  const decision = decide({
    contract,
    checks: passed,
    evidence,
    review: outcome({ acceptance_criteria: [{ index: 0, verdict: "not_satisfied", evidence: "no CTA" }] }),
  });
  assert.equal(decision.status, "fail");
  assert.match(decision.findings[0].summary, /Acceptance criterion \[0\] is not satisfied/);
});

test("model findings keep their category, so a specification defect is distinguishable", () => {
  const decision = decide({
    contract,
    checks: passed,
    evidence,
    review: outcome({
      status: "fail",
      findings: [{ category: "specification", severity: "blocking", summary: "Spec contradicts itself.", path: null }],
    }),
  });
  assert.equal(decision.status, "fail");
  assert.deepEqual(decision.findings, [
    { category: "specification", severity: "blocking", summary: "Spec contradicts itself." },
  ]);
});

test("an unverified or missing criterion holds for a decision instead of passing", () => {
  const unverified = decide({
    contract,
    checks: passed,
    evidence,
    review: outcome({ acceptance_criteria: [{ index: 0, verdict: "not_verified", evidence: "cannot run UI" }] }),
  });
  assert.equal(unverified.status, "needs_decision");
  const missing = decide({ contract, checks: passed, evidence, review: outcome({ acceptance_criteria: [] }) });
  assert.equal(missing.status, "needs_decision");
  assert.match(missing.reasons.join(" "), /not assessed/);
});

test("a decision outranks defects", () => {
  const decision = decide({
    contract,
    checks: failedCheck,
    evidence,
    review: outcome({
      status: "needs_decision",
      decisions_needed: [{ question: "Which empty state?", options: ["A", "B"], recommendation: "A" }],
    }),
  });
  assert.equal(decision.status, "needs_decision");
  assert.match(decision.reasons[0], /Which empty state\? Options: A \| B/);
});

test("fail without a blocking finding is not usable", () => {
  const decision = decide({ contract, checks: passed, evidence, review: outcome({ status: "fail" }) });
  assert.equal(decision.status, "failed");
});

test("without a verdict: failed checks still fail, a limit blocks, and anything else is failed", () => {
  assert.equal(
    decide({ contract, checks: failedCheck, evidence, review: outcome(null, { limitHit: "max_turns" }) }).status,
    "fail",
  );
  assert.equal(
    decide({ contract, checks: passed, evidence, review: outcome(null, { limitHit: "max_runtime" }) }).status,
    "blocked",
  );
  const refused = decide({ contract, checks: passed, evidence, review: outcome(null, { problem: "declined" }) });
  assert.equal(refused.status, "failed");
  assert.match(refused.reasons[0], /declined/);
});

test("an Evidence Package missing a required check is a blocking evidence finding", () => {
  const decision = decide({ contract, checks: passed, evidence: { ...evidence, validation: [] }, review: outcome({}) });
  assert.equal(decision.status, "fail");
  assert.equal(decision.findings[0].category, "evidence");
});
