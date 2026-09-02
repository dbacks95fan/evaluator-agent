import assert from "node:assert/strict";
import test from "node:test";
import { validateEvaluation } from "./validate.js";
import type { WorkContract } from "./types.js";

const contract: WorkContract = {
  schema_version: 2,
  work_item: "TEST-1",
  objective: "Prove validation behavior",
  acceptance_criteria: { AC1: "Required behavior works" },
  intent: { path: ".agent/work/TEST-1/intent.md", revision: "abc123", sha256: "intent-hash", reviewUrl: "https://example.test/intent", status: "Accepted", acceptedBy: "Test User", acceptedAt: "2026-09-02T00:00:00Z" },
  board: { provider: "trello", workItemId: "TEST-1", workItemUrl: "https://trello.test/TEST-1", workItemType: "User Story" },
};

function passingResult() {
  return {
    workItem: "TEST-1",
    status: "pass",
    summary: "Verified",
    acceptanceCriteria: {
      AC1: { status: "pass", evidence: ["test passed"], explanation: "Observed expected behavior" },
    },
    findings: [],
    risks: [],
    scope: { status: "acceptable", unexpectedChanges: [] },
    preflight: { status: "pass", facts: ["Accepted intent verified"], inferences: [], decisionsRequired: [] },
    traceability: { intentPath: contract.intent.path, intentRevision: "abc123", intentHash: contract.intent.sha256, contractHash: "contract-hash", evidenceRunId: "run-1", boardWorkItemUrl: contract.board.workItemUrl },
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
