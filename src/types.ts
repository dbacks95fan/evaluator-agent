export type EvaluationStatus = "pass" | "fail" | "needs_decision";
export type CriterionStatus = "pass" | "fail" | "partial" | "not_verified";
export type FindingSeverity = "critical" | "high" | "medium" | "low";

export interface WorkContract {
  work_item: string;
  objective: string;
  acceptance_criteria: Record<string, string>;
  constraints?: string[];
  architectural_constraints?: string[];
  known_dependencies?: string[];
  non_goals?: string[];
  required_validation?: string[];
  escalation_conditions?: string[];
}

export interface EvidencePackage {
  workItem: string;
  status: string;
  summary: string;
  contractHash?: string;
  runId?: string;
  acceptanceCriteria?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  filesChanged?: string[];
  assumptions?: string[];
  risks?: string[];
  escalations?: unknown[];
  discrepancies?: string[];
  worktree?: { path?: string; branch?: string; baseBranch?: string };
  [key: string]: unknown;
}

export interface CriterionEvaluation {
  status: CriterionStatus;
  evidence: string[];
  explanation: string;
}

export interface Finding {
  id: string;
  severity: FindingSeverity;
  type: "acceptance_criteria" | "defect" | "regression" | "scope" | "test_quality" | "architecture" | "security" | "risk" | "other";
  criterion?: string;
  file?: string;
  line?: number;
  problem: string;
  evidence: string[];
  expectedBehavior?: string;
}

export interface EvaluationResult {
  workItem: string;
  status: EvaluationStatus;
  summary: string;
  acceptanceCriteria: Record<string, CriterionEvaluation>;
  findings: Finding[];
  risks: string[];
  scope: {
    status: "acceptable" | "unexpected_changes" | "not_verified";
    unexpectedChanges: string[];
  };
  recommendation: "human_approval" | "return_to_coding_agent" | "human_decision";
}
