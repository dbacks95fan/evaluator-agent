import assert from "node:assert/strict";
import test from "node:test";
import { validateEvaluation } from "./validate.js";
import type { WorkContract } from "./types.js";

const contract: WorkContract = {
  schema_version: 3,
  work_item: { product_id: "TEST", intent_id: "TEST-1", intent_version: 1, trello_card_id: "card-1" },
  intent: { repository: "https://github.com/example/backlog", commit_sha: "a".repeat(40), path: "intents/TEST-1/intent.md", sha256: "intent-hash" },
  policy_profile_id: "TEST-DEFAULT",
  policy_profile_version: "1",
  policy_profile: { repository: "https://github.com/example/backlog", commit_sha: "a".repeat(40), path: "profiles/default.md", sha256: "profile-hash" },
  target: { repository: "https://github.com/example/product", commit_sha: "b".repeat(40) },
  acceptance_criteria: ["Required behavior works"],
  permitted_scope: { included: ["Feature"], excluded: [] },
  required_validation: [{ name: "tests", command: "npm test" }],
  policy_controls: [],
  release_requirements: [],
  observation_requirements: [],
};

function passingResult() {
  return {
    workItem: contract.work_item.intent_id,
    status: "pass",
    summary: "Verified",
    acceptanceCriteria: {
      AC1: { status: "pass", evidence: ["test passed"], explanation: "Observed expected behavior" },
    },
    findings: [],
    risks: [],
    scope: { status: "acceptable", unexpectedChanges: [] },
    preflight: { status: "pass", facts: ["Accepted intent verified"], inferences: [], decisionsRequired: [] },
    traceability: { intentPath: contract.intent.path, intentRevision: contract.intent.commit_sha, intentHash: contract.intent.sha256, contractHash: "contract-hash", evidenceRunId: "run-1", trelloCardId: contract.work_item.trello_card_id },
    recommendation: "human_approval",
  };
}

test("accepts a consistent passing evaluation", () => {
  assert.equal(validateEvaluation(passingResult(), contract).status, "pass");
});

test("rejects pass when a criterion did not pass", () => {
  const result = passingResult();
  result.acceptanceCriteria.AC1.status = "not_verified";
  assert.throws(() => validateEvaluation(result, contract), /Overall pass is invalid/);
});

test("rejects an omitted acceptance criterion", () => {
  const result = passingResult() as Record<string, any>;
  result.acceptanceCriteria = {};
  assert.throws(() => validateEvaluation(result, contract), /omitted acceptance criterion/);
});

test("rejects inconsistent status and recommendation", () => {
  const result = passingResult();
  result.status = "fail";
  assert.throws(() => validateEvaluation(result, contract), /requires recommendation/);
});
