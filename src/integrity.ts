import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readIntent } from "./intent.js";
import type { EvidencePackage, WorkContract } from "./types.js";

export async function sha256File(path: string): Promise<string> {
  const raw = await readFile(path);
  return createHash("sha256").update(raw).digest("hex");
}

export async function verifyHandoff(
  contractPath: string,
  intentPath: string,
  contract: WorkContract,
  evidence: EvidencePackage,
): Promise<void> {
  const intent = await readIntent(intentPath);
  if (intent.workItem !== contract.work_item) throw new Error(`Intent Work ID '${intent.workItem}' does not match contract '${contract.work_item}'`);
  if (intent.status !== "Accepted" || !intent.acceptedBy || !intent.acceptedAt) throw new Error("Intent is not accepted with complete acceptance metadata");
  if (intent.openDecisions.length > 0) throw new Error("Intent has unresolved open decisions and requires human decision");
  if (contract.intent.path !== intentPath && !intentPath.endsWith(contract.intent.path.replace(/\\/g, "/"))) throw new Error("Intent path does not match Work Contract intent reference");
  if (contract.intent.sha256 !== intent.sha256) throw new Error("Intent hash does not match Work Contract intent reference");
  if (contract.intent.status !== "Accepted") throw new Error("Work Contract does not reference an accepted intent");
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
