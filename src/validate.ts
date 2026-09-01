import type { EvaluationResult, WorkContract } from "./types.js";

const statuses = new Set(["pass", "fail", "needs_decision"]);
const criterionStatuses = new Set(["pass", "fail", "partial", "not_verified"]);
const recommendations = new Set(["human_approval", "return_to_coding_agent", "human_decision"]);

export function validateEvaluation(value: unknown, contract: WorkContract): EvaluationResult {
  if (!value || typeof value !== "object") throw new Error("Evaluation result is not an object");
  const result = value as EvaluationResult;

  if (result.workItem !== contract.work_item) {
    throw new Error(`Evaluation workItem '${result.workItem}' does not match contract '${contract.work_item}'`);
  }
  if (!statuses.has(result.status)) throw new Error(`Invalid evaluation status '${result.status}'`);
  if (!recommendations.has(result.recommendation)) throw new Error(`Invalid recommendation '${result.recommendation}'`);

  const expected = result.status === "pass" ? "human_approval" : result.status === "fail" ? "return_to_coding_agent" : "human_decision";
  if (result.recommendation !== expected) {
    throw new Error(`Status '${result.status}' requires recommendation '${expected}'`);
  }

  if (!result.acceptanceCriteria || typeof result.acceptanceCriteria !== "object") {
    throw new Error("Missing acceptanceCriteria evaluation");
  }

  for (const id of Object.keys(contract.acceptance_criteria)) {
    const criterion = result.acceptanceCriteria[id];
    if (!criterion) throw new Error(`Evaluator omitted acceptance criterion '${id}'`);
    if (!criterionStatuses.has(criterion.status)) {
      throw new Error(`Acceptance criterion '${id}' has invalid status '${criterion.status}'`);
    }
    if (!Array.isArray(criterion.evidence)) {
      throw new Error(`Acceptance criterion '${id}' is missing its evidence array`);
    }
    if (typeof criterion.explanation !== "string" || criterion.explanation.length === 0) {
      throw new Error(`Acceptance criterion '${id}' is missing an explanation`);
    }
  }

  if (result.status === "pass") {
    for (const id of Object.keys(contract.acceptance_criteria)) {
      if (result.acceptanceCriteria[id].status !== "pass") {
        throw new Error(`Overall pass is invalid because acceptance criterion '${id}' did not pass`);
      }
    }
  }

  if (!Array.isArray(result.findings)) throw new Error("Missing findings array");
  if (!Array.isArray(result.risks)) throw new Error("Missing risks array");
  if (!result.scope || !Array.isArray(result.scope.unexpectedChanges)) {
    throw new Error("Missing scope evaluation");
  }

  return result;
}
