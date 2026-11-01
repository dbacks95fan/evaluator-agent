// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Executes one Evaluation-stage invocation end to end and returns a correlated StageResult.
// ABOUTME: admit -> fetch and verify -> setup -> rerun checks -> model review -> verdict -> publish the package.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runCommand, sandboxEnv, truncateMiddle } from "./commands.js";
import { secretValues, type RuntimeConfig } from "./config.js";
import { DriverGit, type GitCredentials } from "./git.js";
import { admitEvaluation, BlockedError, identityOf, type AdmittedEvaluation } from "./invocation.js";
import { validateRecord } from "./lifecycle.js";
import type { Logger } from "./log.js";
import type { CheckManifest } from "./manifest.js";
import { prepareWorkspace, type VerifiedInputs } from "./preflight.js";
import { buildFirstMessage, INSTRUCTIONS } from "./prompt.js";
import { redact } from "./redact.js";
import { runReview, type ResponsesClient, type ReviewOutcome } from "./review.js";
import type { ArtifactRef, EvaluationPackage, StageResult, ValidationResult } from "./types.js";
import { buildEvaluationPackage, buildStageResult, decide } from "./verdict.js";

export interface RunDependencies {
  config: RuntimeConfig;
  manifest: CheckManifest;
  model: ResponsesClient;
  log: Logger;
  /** Absent when every remote is local and needs no token. */
  credentials?: GitCredentials;
}

/** Diagnostic detail for people and logs. Not a lifecycle record; the StageResult is authoritative. */
export interface RunDiagnostics {
  reasons: string[];
  checks: ValidationResult[];
  review?: Pick<ReviewOutcome, "turns" | "usage" | "limitHit" | "refused" | "problem" | "durationMs">;
}

export interface RunOutcome {
  /** Null only when the input was too malformed to correlate to an invocation. */
  stageResult: StageResult | null;
  evaluationPackage: EvaluationPackage | null;
  diagnostics: RunDiagnostics;
}

/** Statuses that carry a published Evaluation Package; blocked and failed runs may not have a trustworthy one. */
const PUBLISHED = new Set(["pass", "fail", "needs_decision"]);

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function executeEvaluation(raw: unknown, deps: RunDependencies): Promise<RunOutcome> {
  const identity = identityOf(raw);
  const diagnostics: RunDiagnostics = { reasons: [], checks: [] };
  const secrets = secretValues(deps.config);
  if (!identity) {
    diagnostics.reasons.push("The request is not a StageInvocation with a usable invocation_id and work_item.");
    return { stageResult: null, evaluationPackage: null, diagnostics };
  }

  const runDir = join(
    deps.config.workRoot,
    `${identity.invocationId.replace(/[^A-Za-z0-9._-]/g, "_")}-${randomUUID().slice(0, 8)}`,
  );
  const result: ResultBuilder = (status, summary, extra = {}) =>
    buildStageResult({
      invocationId: identity.invocationId,
      stage: identity.stage,
      workItem: identity.workItem,
      status,
      summary: redact(summary, secrets),
      findings: diagnostics.reasons.map((r) => redact(r, secrets)),
      ...extra,
    });

  let outcome: RunOutcome;
  try {
    mkdirSync(runDir, { recursive: true });
    deps.log("run_started", { invocationId: identity.invocationId, intentId: identity.workItem.intent_id });
    outcome = await execute(raw, deps, runDir, diagnostics, result);
  } catch (err) {
    if (err instanceof BlockedError) {
      diagnostics.reasons.push(...err.reasons);
      outcome = {
        stageResult: result("blocked", "The evaluation could not proceed; see findings."),
        evaluationPackage: null,
        diagnostics,
      };
    } else {
      const message = redact(err instanceof Error ? err.message : String(err), secrets);
      diagnostics.reasons.push(`Unexpected worker failure: ${message}`);
      deps.log("run_error", { invocationId: identity.invocationId, message });
      outcome = {
        stageResult: result("failed", "The evaluator failed unexpectedly; see findings."),
        evaluationPackage: null,
        diagnostics,
      };
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  // The result itself must satisfy the canonical contract before anyone sees it.
  const check = validateRecord("StageResult", outcome.stageResult);
  if (!check.valid) {
    diagnostics.reasons.push(`Internal error: the produced StageResult was invalid: ${check.errors.join("; ")}`);
    outcome = {
      stageResult: result("failed", "The evaluator produced an invalid result."),
      evaluationPackage: null,
      diagnostics,
    };
  }
  deps.log("run_finished", { invocationId: identity.invocationId, status: outcome.stageResult?.status });
  return outcome;
}

type ResultBuilder = (
  status: StageResult["status"],
  summary: string,
  extra?: Partial<Parameters<typeof buildStageResult>[0]>,
) => StageResult;

async function execute(
  raw: unknown,
  deps: RunDependencies,
  runDir: string,
  diagnostics: RunDiagnostics,
  result: ResultBuilder,
): Promise<RunOutcome> {
  const { config, log } = deps;
  const secrets = secretValues(config);
  const admitted = admitEvaluation(raw, deps.manifest);
  const git = new DriverGit(join(runDir, "git-home"), config.gitIdentity, deps.credentials);
  const verified = await prepareWorkspace(admitted, git, runDir);
  const invocationId = admitted.invocation.invocation_id;
  log("preflight_passed", { invocationId, handoff: verified.handoff, candidate: verified.candidate.commit_sha });

  const home = join(runDir, "home");
  mkdirSync(home, { recursive: true });
  const env = sandboxEnv(home, config.commandEnv);
  await runSetup(admitted, verified, git, env, deps);
  diagnostics.checks = await runChecks(verified, admitted, env, deps);

  const base = verified.workContract.target.commit_sha;
  const candidateSha = verified.candidate.commit_sha;
  const review = await runReview({
    client: deps.model,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    instructions: INSTRUCTIONS,
    firstMessage: buildFirstMessage({
      workContract: verified.workContract,
      specText: verified.specText,
      intentText: verified.intentText,
      profileText: verified.profileText,
      evidence: verified.evidence,
      checks: diagnostics.checks,
      candidateSha,
      baseSha: base,
    }),
    tools: {
      workspace: verified.workspace,
      maxOutputChars: config.limits.maxToolOutputChars,
      diff: (path) =>
        git.run(["diff", "--no-color", base, candidateSha, "--", path ?? ".", ":(exclude).agent"], verified.workspace),
    },
    maxTurns: config.limits.maxTurns,
    maxRuntimeMs: config.limits.maxRuntimeMs,
    onEvent: (event, data) => log(event, { invocationId, ...data }),
  });
  diagnostics.review = {
    turns: review.turns,
    usage: review.usage,
    limitHit: review.limitHit,
    refused: review.refused,
    problem: review.problem,
    durationMs: review.durationMs,
  };

  const decision = decide({
    contract: verified.workContract,
    checks: diagnostics.checks,
    evidence: verified.evidence,
    review,
  });
  diagnostics.reasons.unshift(...decision.reasons);
  const summary = redact(decision.summary, secrets);
  const evaluationPackage = buildEvaluationPackage({
    workItem: admitted.invocation.work_item,
    inputArtifacts: verified.inputArtifacts,
    candidate: verified.candidate,
    checks: diagnostics.checks,
    decision: { ...decision, summary },
  });

  if (!PUBLISHED.has(decision.status)) {
    return {
      stageResult: result(decision.status, summary, { candidate: verified.candidate }),
      evaluationPackage: null,
      diagnostics,
    };
  }
  const packageCheck = validateRecord("EvaluationPackage", evaluationPackage);
  if (!packageCheck.valid) {
    throw new Error(`The Evaluation Package is invalid: ${packageCheck.errors.join("; ")}`);
  }
  const packageRef = await publish(admitted, verified, git, evaluationPackage);
  log("evaluation_published", { invocationId, status: decision.status, package: packageRef.commit_sha });
  const findingLines = evaluationPackage.findings.map((f) => `[${f.severity} ${f.category}] ${f.summary}`);
  diagnostics.reasons.push(...findingLines);
  return {
    stageResult: result(decision.status, summary, { outputArtifacts: [packageRef], candidate: verified.candidate }),
    evaluationPackage,
    diagnostics,
  };
}

/** Repository-declared setup (e.g. dependency install). It must not change tracked files. */
async function runSetup(
  admitted: AdmittedEvaluation,
  verified: VerifiedInputs,
  git: DriverGit,
  env: NodeJS.ProcessEnv,
  deps: RunDependencies,
): Promise<void> {
  for (const command of admitted.repository.setup) {
    const outcome = await runCommand({
      command,
      cwd: verified.workspace,
      shell: deps.config.shell,
      env,
      timeoutMs: deps.config.limits.setupTimeoutMs,
      maxOutputChars: 4000,
    });
    deps.log("setup_command", { command, exitCode: outcome.exitCode, durationMs: outcome.durationMs });
    if (outcome.exitCode !== 0) {
      const why = outcome.timedOut ? "timed out" : `exited with ${outcome.exitCode}`;
      throw new BlockedError([`Setup command "${command}" ${why}: ${truncateMiddle(outcome.output, 1500)}`]);
    }
  }
  const changed = await git.trackedChanges(verified.workspace);
  if (changed.length) throw new BlockedError([`Setup modified tracked files: ${changed.join(", ")}.`]);
}

/** Reruns each required check exactly as the trusted manifest defines it, against the candidate checkout. */
async function runChecks(
  verified: VerifiedInputs,
  admitted: AdmittedEvaluation,
  env: NodeJS.ProcessEnv,
  deps: RunDependencies,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const required of verified.workContract.required_validation) {
    const command = admitted.repository.checks[required.name];
    const outcome = await runCommand({
      command,
      cwd: verified.workspace,
      shell: deps.config.shell,
      env,
      timeoutMs: deps.config.limits.checkTimeoutMs,
      maxOutputChars: 1500,
    });
    const passed = outcome.exitCode === 0;
    const status = outcome.timedOut ? "timed out" : `exit ${outcome.exitCode}`;
    const tail = outcome.output.trim() ? ` Output: ${outcome.output.trim()}` : "";
    results.push({
      name: required.name,
      outcome: passed ? "passed" : "failed",
      observed_at: new Date().toISOString(),
      summary: redact(
        `Ran "${command}": ${status} after ${(outcome.durationMs / 1000).toFixed(1)}s.${tail}`,
        secretValues(deps.config),
      ),
    });
    deps.log("check_result", { name: required.name, exitCode: outcome.exitCode, durationMs: outcome.durationMs });
  }
  return results;
}

/** Commits the Evaluation Package on top of the handoff and pushes it, fast-forward only. The candidate is untouched. */
async function publish(
  admitted: AdmittedEvaluation,
  verified: VerifiedInputs,
  git: DriverGit,
  evaluationPackage: EvaluationPackage,
): Promise<ArtifactRef> {
  const { invocation, branch, packagePath, intentId } = admitted;
  // Checks ran repository code; restore Git config before the driver writes, then move to the branch tip.
  git.restoreConfig(verified.workspace, verified.configSnapshot);
  await git.checkoutDetached(verified.workspace, verified.handoff);
  const text = `${JSON.stringify(evaluationPackage, null, 2)}\n`;
  const full = join(verified.workspace, packagePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
  const packageSha = await git.commitSinglePath(
    verified.workspace,
    packagePath,
    `chore(${intentId}): evaluation package for candidate ${verified.candidate.commit_sha.slice(0, 12)}`,
  );
  const committed = await git.changedPaths(verified.workspace, verified.handoff, packageSha);
  if (committed.length !== 1 || committed[0] !== packagePath) {
    throw new Error(`The Evaluation Package commit changed ${committed.join(", ")}, not only ${packagePath}.`);
  }

  const tip = await git.remoteTip(invocation.target.repository, branch, verified.workspace);
  if (tip !== verified.handoff) {
    throw new BlockedError([`The work branch moved to ${tip} during the evaluation; the package was not pushed.`]);
  }
  try {
    await git.pushFastForward(verified.workspace, invocation.target.repository, packageSha, branch);
  } catch (err) {
    throw new BlockedError([`Pushing the Evaluation Package to ${branch} failed: ${(err as Error).message}`]);
  }
  return { repository: invocation.target.repository, commit_sha: packageSha, path: packagePath, sha256: sha256(text) };
}
