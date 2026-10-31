import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256File, verifyHandoff } from "./integrity.js";
import type { EvidencePackage, WorkContract } from "./types.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "evaluator-test-"));
  const intentPath = join(dir, "intent.md");
  await writeFile(intentPath, "# Intent: test\n\n## Identity\n- **Work ID:** TEST-1\n- **Status:** Accepted\n\n## Open decisions\n\n## Handoff\n- **Review URL:** https://example.test/intent\n- **Accepted by:** Test User\n- **Accepted at:** 2026-09-02T00:00:00Z\n", "utf8");
  const contract: WorkContract = {
    schema_version: 3,
    work_item: { product_id: "TEST", intent_id: "TEST-1", intent_version: 1, trello_card_id: "card-1" },
    intent: { repository: "https://github.com/example/backlog", commit_sha: "a".repeat(40), path: "intents/TEST-1/intent.md", sha256: await sha256File(intentPath) },
    policy_profile_id: "TEST-DEFAULT",
    policy_profile_version: "1",
    policy_profile: { repository: "https://github.com/example/backlog", commit_sha: "a".repeat(40), path: "profiles/default.md", sha256: "b".repeat(64) },
    target: { repository: "https://github.com/example/product", commit_sha: "c".repeat(40) },
    acceptance_criteria: ["Works"],
    permitted_scope: { included: ["Feature"], excluded: [] },
    required_validation: [{ name: "tests", command: "npm test" }],
    policy_controls: [],
    release_requirements: [],
    observation_requirements: [],
  };
  const path = join(dir, "contract.json");
  await writeFile(path, JSON.stringify(contract), "utf8");
  return { dir, path, intentPath, contract };
}

test("accepts matching candidate_complete evidence and contract hash", async () => {
  const { dir, path, intentPath, contract } = await fixture();
  try {
    const evidence = { schema_version: "1.0", work_item: contract.work_item, status: "candidate_complete", summary: "done", candidate: { repository: contract.target.repository, commit_sha: "d".repeat(40) }, input_artifacts: [{ repository: "https://github.com/example/product", commit_sha: "c".repeat(40), path: "contract.yaml", sha256: await sha256File(path) }], changed_paths: [], validation: [{ name: "tests", outcome: "passed", observed_at: "2026-10-31T00:00:00Z", summary: "passed" }], policy_control_evidence: [] } as EvidencePackage;
    await verifyHandoff(path, intentPath, contract, evidence);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects evidence for a different work item", async () => {
  const { dir, path, intentPath, contract } = await fixture();
  try {
    const evidence = { schema_version: "1.0", work_item: { ...contract.work_item, intent_id: "OTHER" }, status: "candidate_complete", summary: "done", candidate: { repository: contract.target.repository, commit_sha: "d".repeat(40) }, input_artifacts: [], changed_paths: [], validation: [], policy_control_evidence: [] } as EvidencePackage;
    await assert.rejects(verifyHandoff(path, intentPath, contract, evidence), /does not match the Work Contract work_item/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects non-complete coding-agent runs", async () => {
  const { dir, path, intentPath, contract } = await fixture();
  try {
    const evidence = { schema_version: "1.0", work_item: contract.work_item, status: "blocked", summary: "blocked", candidate: { repository: contract.target.repository, commit_sha: "d".repeat(40) }, input_artifacts: [], changed_paths: [], validation: [], policy_control_evidence: [] } as EvidencePackage;
    await assert.rejects(verifyHandoff(path, intentPath, contract, evidence), /candidate_complete/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a contract hash mismatch", async () => {
  const { dir, path, intentPath, contract } = await fixture();
  try {
    const evidence = { schema_version: "1.0", work_item: contract.work_item, status: "candidate_complete", summary: "done", candidate: { repository: contract.target.repository, commit_sha: "d".repeat(40) }, input_artifacts: [{ repository: "https://github.com/example/product", commit_sha: "c".repeat(40), path: "contract.yaml", sha256: "wrong" }] } as EvidencePackage;
    await assert.rejects(verifyHandoff(path, intentPath, contract, evidence), /exact Work Contract bytes/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
