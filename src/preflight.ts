// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Fetches the work branch at the handoff, verifies every frozen, accepted, and evidence input, then checks
// ABOUTME: out the exact candidate. Runs before any check or model call; any mismatch blocks the run with the reason.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml } from "yaml";
import type { DriverGit } from "./git.js";
import { BlockedError, type AdmittedEvaluation } from "./invocation.js";
import { validateRecord } from "./lifecycle.js";
import { normalizeRepoUrl, untrustedChecks } from "./manifest.js";
import type { ArtifactRef, CommitRef, EvidencePackage, WorkContract } from "./types.js";

export interface VerifiedInputs {
  workspace: string;
  handoff: string;
  /** The immutable candidate the Evidence Package names; the workspace is checked out here. */
  candidate: CommitRef;
  configSnapshot: Buffer;
  workContract: WorkContract;
  evidence: EvidencePackage;
  intentText: string;
  profileText: string;
  specText: string;
  /** Every immutable input this run relied on, for the Evaluation Package. */
  inputArtifacts: ArtifactRef[];
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function prepareWorkspace(
  admitted: AdmittedEvaluation,
  git: DriverGit,
  runDir: string,
): Promise<VerifiedInputs> {
  const { invocation, branch } = admitted;
  const freeze = invocation.freeze_activation;
  const handoff = invocation.target.commit_sha;
  const url = invocation.target.repository;
  mkdirSync(runDir, { recursive: true });

  // Only one writer may use the branch; it must still point at the handoff we were given.
  const tip = await git.remoteTip(url, branch, runDir);
  if (tip === null) throw new BlockedError([`The assigned work branch ${branch} does not exist on ${url}.`]);
  if (tip !== handoff) {
    throw new BlockedError([
      `The work branch ${branch} is at ${tip}, not the handoff commit ${handoff}; another writer may have pushed.`,
    ]);
  }

  const workspace = join(runDir, "repo");
  await git.cloneBranch(url, branch, workspace, runDir);
  const head = await git.head(workspace);
  if (head !== handoff)
    throw new BlockedError([`The cloned branch head ${head} is not the handoff commit ${handoff}.`]);
  const configSnapshot = git.snapshotConfig(workspace);

  const reasons: string[] = [];
  const specBytes = await verifyAccepted(git, workspace, handoff, admitted.spec, reasons);
  const contractBytes = await verifyAccepted(git, workspace, handoff, admitted.workContract, reasons);
  const evidenceBytes = await verifyAccepted(git, workspace, handoff, admitted.evidence, reasons);

  // The copies on the branch are the only frozen inputs this agent reads; it never contacts the
  // intent backlog. The freeze fingerprints make any changed byte fail here.
  const intentCopy = await git.readBlob(workspace, handoff, admitted.frozenIntentPath);
  const profileCopy = await git.readBlob(workspace, handoff, admitted.frozenProfilePath);
  checkFingerprint(intentCopy, freeze.intent.sha256, `the frozen intent copy ${admitted.frozenIntentPath}`, reasons);
  checkFingerprint(
    profileCopy,
    freeze.policy_profile.sha256,
    `the frozen policy profile copy ${admitted.frozenProfilePath}`,
    reasons,
  );

  let workContract: WorkContract | undefined;
  if (contractBytes) {
    workContract = await verifyWorkContract(contractBytes, admitted, git, workspace, handoff, reasons);
  }
  let evidence: EvidencePackage | undefined;
  if (evidenceBytes) evidence = await verifyEvidence(evidenceBytes, admitted, git, workspace, handoff, reasons);
  if (workContract && evidence && !reasons.length) {
    if (!(await git.isAncestor(workspace, workContract.target.commit_sha, evidence.candidate.commit_sha))) {
      reasons.push("The candidate was not built on the accepted Work Contract's base commit.");
    }
  }

  if (workContract) reasons.push(...untrustedChecks(admitted.repository, workContract.required_validation));

  if (
    reasons.length ||
    !workContract ||
    !evidence ||
    !specBytes ||
    !contractBytes ||
    !evidenceBytes ||
    !intentCopy ||
    !profileCopy
  ) {
    throw new BlockedError(reasons);
  }

  // Evaluate the exact candidate, not the branch tip that carries its evidence.
  await git.checkoutDetached(workspace, evidence.candidate.commit_sha);

  return {
    workspace,
    handoff,
    candidate: { repository: invocation.target.repository, commit_sha: evidence.candidate.commit_sha },
    configSnapshot,
    workContract,
    evidence,
    intentText: intentCopy.toString("utf8"),
    profileText: profileCopy.toString("utf8"),
    specText: specBytes.toString("utf8"),
    inputArtifacts: [freeze.intent, freeze.policy_profile, admitted.spec, admitted.workContract, admitted.evidence],
  };
}

function sameArtifact(a: ArtifactRef, b: ArtifactRef): boolean {
  return (
    normalizeRepoUrl(a.repository) === normalizeRepoUrl(b.repository) &&
    a.commit_sha === b.commit_sha &&
    a.path === b.path &&
    a.sha256 === b.sha256
  );
}

function checkFingerprint(bytes: Buffer | null, expected: string, label: string, reasons: string[]): void {
  if (!bytes) reasons.push(`${label} is missing at the handoff commit.`);
  else if (sha256(bytes) !== expected) reasons.push(`${label} does not match its recorded SHA-256 ${expected}.`);
}

/**
 * An accepted artifact must hash correctly at its recorded commit, that commit must
 * be in the branch history, and the bytes must be unchanged at the handoff.
 */
async function verifyAccepted(
  git: DriverGit,
  workspace: string,
  handoff: string,
  ref: ArtifactRef,
  reasons: string[],
): Promise<Buffer | null> {
  const atRecorded = await git.readBlob(workspace, ref.commit_sha, ref.path);
  if (!atRecorded) {
    reasons.push(`${ref.path} is not reachable at its recorded commit ${ref.commit_sha}.`);
    return null;
  }
  if (sha256(atRecorded) !== ref.sha256) {
    reasons.push(`${ref.path} at ${ref.commit_sha} does not match its recorded SHA-256.`);
    return null;
  }
  if (!(await git.isAncestor(workspace, ref.commit_sha, handoff))) {
    reasons.push(`${ref.path}'s recorded commit ${ref.commit_sha} is not in the work branch history.`);
    return null;
  }
  const atHandoff = await git.readBlob(workspace, handoff, ref.path);
  if (!atHandoff || !atHandoff.equals(atRecorded)) {
    reasons.push(`${ref.path} has changed since its recorded commit ${ref.commit_sha}.`);
    return null;
  }
  return atRecorded;
}

async function verifyWorkContract(
  bytes: Buffer,
  admitted: AdmittedEvaluation,
  git: DriverGit,
  workspace: string,
  handoff: string,
  reasons: string[],
): Promise<WorkContract | undefined> {
  let parsed: unknown;
  try {
    parsed = parseYaml(bytes.toString("utf8"));
  } catch (err) {
    reasons.push(`work-contract.yaml is not valid YAML: ${(err as Error).message}`);
    return undefined;
  }
  const schema = validateRecord("WorkContract", parsed);
  if (!schema.valid) {
    reasons.push(`work-contract.yaml is not a valid Work Contract v3: ${schema.errors.join("; ")}.`);
    return undefined;
  }
  const contract = parsed as WorkContract;
  const freeze = admitted.invocation.freeze_activation;
  if (!isDeepStrictEqual(contract.work_item, admitted.invocation.work_item)) {
    reasons.push("The Work Contract work item does not match the invocation.");
  }
  if (!isDeepStrictEqual(contract.intent, freeze.intent)) {
    reasons.push("The Work Contract intent reference does not match the active freeze.");
  }
  if (
    !isDeepStrictEqual(contract.policy_profile, freeze.policy_profile) ||
    contract.policy_profile_id !== freeze.policy_profile_id ||
    contract.policy_profile_version !== freeze.policy_profile_version
  ) {
    reasons.push("The Work Contract policy profile does not match the active freeze.");
  }
  if (normalizeRepoUrl(contract.target.repository) !== normalizeRepoUrl(admitted.invocation.target.repository)) {
    reasons.push("The Work Contract targets a different repository than the invocation.");
  } else if (!(await git.isAncestor(workspace, contract.target.commit_sha, handoff))) {
    reasons.push(`The Work Contract base commit ${contract.target.commit_sha} is not in the work branch history.`);
  }
  return contract;
}

/** The Evidence Package is the Coding Agent's claim about the candidate; only its identity is trusted here. */
async function verifyEvidence(
  bytes: Buffer,
  admitted: AdmittedEvaluation,
  git: DriverGit,
  workspace: string,
  handoff: string,
  reasons: string[],
): Promise<EvidencePackage | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    reasons.push("The Evidence Package is not valid JSON.");
    return undefined;
  }
  const schema = validateRecord("EvidencePackage", parsed);
  if (!schema.valid) {
    reasons.push(`The Evidence Package is invalid: ${schema.errors.join("; ")}.`);
    return undefined;
  }
  const evidence = parsed as EvidencePackage;
  if (!isDeepStrictEqual(evidence.work_item, admitted.invocation.work_item)) {
    reasons.push("The Evidence Package work item does not match the invocation.");
  }
  if (evidence.status !== "candidate_complete") {
    reasons.push(`Only a candidate_complete Evidence Package can be evaluated; this one is "${evidence.status}".`);
  }
  if (normalizeRepoUrl(evidence.candidate.repository) !== normalizeRepoUrl(admitted.invocation.target.repository)) {
    reasons.push("The Evidence Package candidate is in a different repository than the invocation.");
    return evidence;
  }
  const candidate = evidence.candidate.commit_sha;
  if (candidate === handoff) {
    reasons.push("The candidate is the handoff commit itself; the Evidence Package must be committed after it.");
  } else if (!(await git.isAncestor(workspace, candidate, handoff))) {
    reasons.push(`The candidate ${candidate} is not in the work branch history.`);
  }
  for (const accepted of [admitted.spec, admitted.workContract]) {
    if (!evidence.input_artifacts.some((ref) => sameArtifact(ref, accepted))) {
      reasons.push(`The Evidence Package does not name the accepted ${accepted.path} it was built from.`);
    }
  }
  return evidence;
}
