import type { EvaluationResult, WorkContract } from "./types.js";

const statuses = new Set(["pass", "fail", "needs_decision"]);
const recommendations = new Set(["human_approval", "return_to_coding_agent", "human_decision"]);

export function validateEvaluation(value: unknown, contract: WorkContract): EvaluationResult {
  if (!value || typeof value !== "object") throw new Error("Evaluation result is not an object");
  const result = value as EvaluationResult;
  if (result.workItem !== contract.work_item) throw new Error(`Evaluation workItem '${result.workItem}' does not match contract '${contract.work_item}'`);
  if (!statuses.has(result.status)) throw new Error(`Invalid evaluation status '${result.status}'`);
  if (!recommendations.has(result.recommendation)) throw new Error(`Invalid recommendation '${result.recommendation}'`);

  const expected = result.status === "pass" ? "human_approval" : result.status === "fail" ? "return_to_coding_agent" : "human_decision";
  if (result.recommendation !== expected) throw new Error(`Status '${result.status}' requires recommendation '${expected}'`);

  if (!result.acceptanceCriteria || typeof result.acceptanceCriteria !== "object") throw new Error("Missing acceptanceCriteria evaluation");
  for (const id of Object.keys(contract.acceptance_criteria)) {
    if (!result.acceptanceCriteria[id]) throw new Error(`Evaluator omitted acceptance criterion '${id}'`);
  }
  if (!Array.isArray(result.findings)) throw new Error("Missing findings array");
  if (!Array.isArray(result.risks)) throw new Error("Missing risks array");
  return result;
}
