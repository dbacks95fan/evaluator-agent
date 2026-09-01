import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256File, verifyHandoff } from "./integrity.js";
import type { EvidencePackage, WorkContract } from "./types.js";

const contract: WorkContract = {
  work_item: "TEST-1",
  objective: "Verify handoff",
  acceptance_criteria: { AC1: "Works" },
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "evaluator-test-"));
  const path = join(dir, "contract.json");
  await writeFile(path, JSON.stringify(contract), "utf8");
  return { dir, path };
}

test("accepts matching candidate_complete evidence and contract hash", async () => {
  const { dir, path } = await fixture();
  try {
    const evidence = { workItem: "TEST-1", status: "candidate_complete", summary: "done", contractHash: await sha256File(path) } as EvidencePackage;
    await verifyHandoff(path, contract, evidence);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects evidence for a different work item", async () => {
  const { dir, path } = await fixture();
  try {
    const evidence = { workItem: "OTHER", status: "candidate_complete", summary: "done" } as EvidencePackage;
    await assert.rejects(verifyHandoff(path, contract, evidence), /does not match contract/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects non-complete coding-agent runs", async () => {
  const { dir, path } = await fixture();
  try {
    const evidence = { workItem: "TEST-1", status: "blocked", summary: "blocked" } as EvidencePackage;
    await assert.rejects(verifyHandoff(path, contract, evidence), /candidate_complete/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a contract hash mismatch", async () => {
  const { dir, path } = await fixture();
  try {
    const evidence = { workItem: "TEST-1", status: "candidate_complete", summary: "done", contractHash: "wrong" } as EvidencePackage;
    await assert.rejects(verifyHandoff(path, contract, evidence), /hash mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
