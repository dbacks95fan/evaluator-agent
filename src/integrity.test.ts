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
    schema_version: 2,
    work_item: "TEST-1",
    objective: "Verify handoff",
    acceptance_criteria: { AC1: "Works" },
    intent: { path: "intent.md", revision: "abc123", sha256: await sha256File(intentPath), reviewUrl: "https://example.test/intent", status: "Accepted", acceptedBy: "Test User", acceptedAt: "2026-09-02T00:00:00Z" },
    board: { provider: "trello", workItemId: "TEST-1", workItemUrl: "https://trello.test/TEST-1", workItemType: "User Story" },
  };
  const path = join(dir, "contract.json");
  await writeFile(path, JSON.stringify(contract), "utf8");
  return { dir, path, intentPath, contract };
}

test("accepts matching candidate_complete evidence and contract hash", async () => {
  const { dir, path, intentPath, contract } = await fixture();
  try {
    const evidence = { workItem: "TEST-1", status: "candidate_complete", summary: "done", contractHash: await sha256File(path) } as EvidencePackage;
    await verifyHandoff(path, intentPath, contract, evidence);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects evidence for a different work item", async () => {
  const { dir, path, intentPath, contract } = await fixture();
  try {
    const evidence = { workItem: "OTHER", status: "candidate_complete", summary: "done" } as EvidencePackage;
    await assert.rejects(verifyHandoff(path, intentPath, contract, evidence), /does not match contract/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects non-complete coding-agent runs", async () => {
  const { dir, path, intentPath, contract } = await fixture();
  try {
    const evidence = { workItem: "TEST-1", status: "blocked", summary: "blocked" } as EvidencePackage;
    await assert.rejects(verifyHandoff(path, intentPath, contract, evidence), /candidate_complete/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a contract hash mismatch", async () => {
  const { dir, path, intentPath, contract } = await fixture();
  try {
    const evidence = { workItem: "TEST-1", status: "candidate_complete", summary: "done", contractHash: "wrong" } as EvidencePackage;
    await assert.rejects(verifyHandoff(path, intentPath, contract, evidence), /hash mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
