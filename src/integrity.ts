import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { EvidencePackage, WorkContract } from "./types.js";

export async function sha256File(path: string): Promise<string> {
  const raw = await readFile(path);
  return createHash("sha256").update(raw).digest("hex");
}

export async function verifyHandoff(
  contractPath: string,
  contract: WorkContract,
  evidence: EvidencePackage,
): Promise<void> {
  if (evidence.workItem !== contract.work_item) {
    throw new Error(
      `Evidence workItem '${String(evidence.workItem)}' does not match contract '${contract.work_item}'`,
    );
  }

  if (evidence.status !== "candidate_complete") {
    throw new Error(
      `Evaluator requires Coding Agent status 'candidate_complete'; received '${String(evidence.status)}'`,
    );
  }

  if (evidence.contractHash) {
    const actualHash = await sha256File(contractPath);
    if (actualHash !== evidence.contractHash) {
      throw new Error(
        `Work Contract hash mismatch: evidence=${evidence.contractHash}, actual=${actualHash}`,
      );
    }
  }
}
