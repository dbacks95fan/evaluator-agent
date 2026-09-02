export type EvaluationStatus = "pass" | "fail" | "needs_decision";
export type CriterionStatus = "pass" | "fail" | "partial" | "not_verified";
export type FindingSeverity = "critical" | "high" | "medium" | "low";

export interface IntentReference {
  path: string;
  revision: string;
  sha256: string;
  reviewUrl: string;
  status: "Accepted";
  acceptedBy: string;
  acceptedAt: string;
}

export interface BoardReference {
  provider: "trello" | "jira" | "azure_devops" | "other";
  workItemId: string;
  workItemUrl: string;
  workItemType: "User Story" | "Feature" | "Epic" | "Technical Enabler";
  parentWorkItemId?: string;
  parentWorkItemUrl?: string;
  priority?: {
    band: string;
    reviewAttention: string;
    confidence: string;
    readyState: string;
    sequencingScore?: number;
    rationale: string;
  };
}

export interface WorkContract {
  schema_version: 2;
  work_item: string;
  objective: string;
  acceptance_criteria: Record<string, string>;
  intent: IntentReference;
  board: BoardReference;
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
  preflight: {
    status: "pass" | "needs_decision";
    facts: string[];
    inferences: string[];
    decisionsRequired: string[];
  };
  traceability: {
    intentPath: string;
    intentRevision: string;
    intentHash: string;
    contractHash: string;
    evidenceRunId: string;
    boardWorkItemUrl: string;
  };
  decisionBrief?: {
    decisionRequired: string;
    whyNow: string;
    knownFacts: string[];
    evaluatorInferences: string[];
    options: { option: string; impact: string }[];
    consequenceOfNoDecision: string;
  };
  recommendation: "human_approval" | "return_to_coding_agent" | "human_decision";
}
