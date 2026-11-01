// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Decides the evaluation status from rerun checks and the model's review, and builds the canonical records.
// ABOUTME: The review can lower the status but never raise it: pass needs every check passed and nothing blocking.
import type { Review, ReviewOutcome } from "./review.js";
import type {
  ArtifactRef,
  CommitRef,
  EvaluationFinding,
  EvaluationPackage,
  EvaluationStatus,
  EvidencePackage,
  StageResult,
  ValidationResult,
  WorkContract,
  WorkItem,
} from "./types.js";

export interface Decision {
  status: EvaluationStatus;
  findings: EvaluationFinding[];
  /** Plain-language reasons for people; decisions needed and why a result could not be produced. */
  reasons: string[];
  summary: string;
}

/** Findings that come from what the Evaluator itself observed when rerunning the trusted checks. */
export function checkFindings(
  contract: WorkContract,
  checks: ValidationResult[],
  evidence: EvidencePackage,
): EvaluationFinding[] {
  const findings: EvaluationFinding[] = [];
  for (const required of contract.required_validation) {
    const observed = checks.find((c) => c.name === required.name);
    const claimed = evidence.validation.find((v) => v.name === required.name);
    if (!observed || observed.outcome !== "passed") {
      findings.push({
        category: "implementation",
        severity: "blocking",
        summary:
          `Required check ${required.name} ${observed ? observed.outcome : "has no outcome"} when the Evaluator reran it at the candidate. ${observed?.summary ?? ""}`.trim(),
      });
      if (claimed?.outcome === "passed") {
        findings.push({
          category: "evidence",
          severity: "non_blocking",
          summary: `The Evidence Package reported ${required.name} as passed, but it did not pass when rerun.`,
        });
      }
    }
    if (!claimed) {
      findings.push({
        category: "evidence",
        severity: "blocking",
        summary: `The Evidence Package has no recorded outcome for required check ${required.name}.`,
      });
    }
  }
  return findings;
}

function reviewFindings(
  contract: WorkContract,
  review: Review,
): { findings: EvaluationFinding[]; unverified: string[] } {
  const findings: EvaluationFinding[] = review.findings.map((f) => ({
    category: f.category,
    severity: f.severity,
    summary: f.path ? `${f.summary} (${f.path})` : f.summary,
  }));
  const unverified: string[] = [];
  contract.acceptance_criteria.forEach((criterion, index) => {
    const entry = review.acceptance_criteria.find((ac) => ac.index === index);
    if (entry?.verdict === "satisfied") return;
    if (entry?.verdict === "not_satisfied") {
      findings.push({
        category: "implementation",
        severity: "blocking",
        summary: `Acceptance criterion [${index}] is not satisfied: ${criterion} Evidence: ${entry.evidence}`,
      });
      return;
    }
    unverified.push(
      `Acceptance criterion [${index}] could not be verified: ${criterion}${entry ? ` (${entry.evidence})` : " (not assessed)"}`,
    );
  });
  return { findings, unverified };
}

export function decide(args: {
  contract: WorkContract;
  checks: ValidationResult[];
  evidence: EvidencePackage;
  review: ReviewOutcome;
}): Decision {
  const findings = checkFindings(args.contract, args.checks, args.evidence);
  const blocking = () => findings.some((f) => f.severity === "blocking");
  const checkNote = args.checks.map((c) => `${c.name} ${c.outcome}`).join(", ") || "none";
  const { review } = args.review;

  if (!review) {
    const why = args.review.limitHit
      ? `The review stopped at its ${args.review.limitHit.replace("max_", "")} limit before finishing.`
      : (args.review.problem ?? "The review produced no verdict.");
    // Failed checks are enough to route rework even without the model's verdict.
    if (blocking()) {
      return { status: "fail", findings, reasons: [why], summary: `Rerun checks failed (${checkNote}). ${why}` };
    }
    return {
      status: args.review.limitHit ? "blocked" : "failed",
      findings,
      reasons: [why],
      summary: `No evaluation verdict was produced. Rerun checks: ${checkNote}. ${why}`,
    };
  }

  const fromReview = reviewFindings(args.contract, review);
  findings.push(...fromReview.findings);
  const summary = `${review.summary} Rerun checks: ${checkNote}.`;

  // A material decision outranks defects: rework without it would be guesswork.
  if (review.status === "needs_decision" || review.decisions_needed.length) {
    const reasons = review.decisions_needed.map(
      (d) =>
        `Decision needed: ${d.question} Options: ${d.options.join(" | ") || "(none given)"}. Recommendation: ${d.recommendation}`,
    );
    return {
      status: "needs_decision",
      findings,
      reasons: reasons.length ? reasons : [`The Evaluator needs a decision: ${review.summary}`],
      summary,
    };
  }
  if (blocking()) return { status: "fail", findings, reasons: [], summary };
  if (review.status === "fail") {
    return {
      status: "failed",
      findings,
      reasons: ["The model reported fail without any blocking finding, so the result is not usable."],
      summary,
    };
  }
  if (fromReview.unverified.length) {
    return { status: "needs_decision", findings, reasons: fromReview.unverified, summary };
  }
  return { status: "pass", findings, reasons: [], summary };
}

export function buildEvaluationPackage(args: {
  workItem: WorkItem;
  inputArtifacts: ArtifactRef[];
  candidate: CommitRef;
  checks: ValidationResult[];
  decision: Decision;
}): EvaluationPackage {
  return {
    schema_version: "1.0",
    work_item: args.workItem,
    input_artifacts: args.inputArtifacts,
    candidate: args.candidate,
    checks: args.checks,
    findings: args.decision.findings,
    status: args.decision.status,
    summary: args.decision.summary,
  };
}

export function buildStageResult(args: {
  invocationId: string;
  stage?: StageResult["stage"];
  workItem: WorkItem;
  status: EvaluationStatus;
  summary: string;
  findings?: string[];
  outputArtifacts?: ArtifactRef[];
  candidate?: CommitRef;
}): StageResult {
  return {
    schema_version: "1.0",
    invocation_id: args.invocationId,
    stage: args.stage ?? "evaluation",
    work_item: args.workItem,
    status: args.status,
    output_artifacts: args.outputArtifacts ?? [],
    ...(args.candidate ? { candidate: args.candidate } : {}),
    summary: args.summary,
    ...(args.findings?.length ? { findings: args.findings } : {}),
  };
}
