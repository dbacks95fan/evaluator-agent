export type EvaluationStatus = "pass" | "fail" | "needs_decision";
export type CriterionStatus = "pass" | "fail" | "partial" | "not_verified";
export type FindingSeverity = "critical" | "high" | "medium" | "low";

export interface WorkItem {
  product_id: string;
  intent_id: string;
  intent_version: number;
  trello_card_id: string;
}

export interface ArtifactRef {
  repository: string;
  commit_sha: string;
  path: string;
  sha256: string;
}

export interface CommitRef {
  repository: string;
  commit_sha: string;
}

export interface EvaluationFinding {
  category: "implementation" | "specification" | "policy" | "evidence";
  severity: "blocking" | "non_blocking";
  summary: string;
  artifact?: ArtifactRef;
}

export interface EvaluationFinding {
  category: "implementation" | "specification" | "policy" | "evidence";
  severity: "blocking" | "non_blocking";
  summary: string;
  artifact?: ArtifactRef;
}

export interface ValidationResult {
  name: string;
  outcome: "passed" | "failed" | "not_run" | "not_applicable";
  observed_at: string;
  summary: string;
  evidence?: ArtifactRef;
}

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
  schema_version: 3;
  work_item: WorkItem;
  intent: ArtifactRef;
  policy_profile_id: string;
  policy_profile_version: string;
  policy_profile: ArtifactRef;
  target: CommitRef;
  acceptance_criteria: string[];
  permitted_scope: { included: string[]; excluded: string[] };
  required_validation: { name: string; command: string }[];
  policy_controls: { control_id: string; required_action: string; evidence_expected: string }[];
  release_requirements: string[];
  observation_requirements: string[];
}

export interface EvidencePackage {
  schema_version: "1.0";
  work_item: WorkItem;
  input_artifacts: ArtifactRef[];
  candidate: CommitRef;
  changed_paths: string[];
  validation: ValidationResult[];
  policy_control_evidence: { control_id: string; outcome: "addressed" | "not_applicable" | "needs_decision"; summary: string; evidence?: ArtifactRef }[];
  status: "candidate_complete" | "needs_decision" | "blocked" | "failed";
  summary?: string;
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
    trelloCardId: string;
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
