import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readIntent } from "./intent.js";
import type { EvidencePackage, WorkContract } from "./types.js";
import { isDeepStrictEqual } from "node:util";

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
  if (intent.workItem !== contract.work_item.intent_id) throw new Error(`Intent Work ID '${intent.workItem}' does not match contract '${contract.work_item.intent_id}'`);
  if (intent.openDecisions.length > 0) throw new Error("Intent has unresolved open decisions and requires human decision");
  if (contract.intent.sha256 !== intent.sha256) throw new Error("Intent hash does not match Work Contract intent reference");
  if (!isDeepStrictEqual(evidence.work_item, contract.work_item)) {
    throw new Error("Evidence work_item does not match the Work Contract work_item.");
  }

  if (evidence.status !== "candidate_complete") {
    throw new Error(
      `Evaluator requires Coding Agent status 'candidate_complete'; received '${String(evidence.status)}'`,
    );
  }

  const contractHash = await sha256File(contractPath);
  if (!evidence.input_artifacts.some((artifact) => artifact.sha256 === contractHash)) throw new Error("Evidence does not reference the exact Work Contract bytes being evaluated.");
}
