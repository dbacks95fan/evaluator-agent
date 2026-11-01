// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Test helpers: a POSIX shell location, real Git repositories that stand in for GitHub remotes, a full
// ABOUTME: Evaluation handoff (spec, candidate, Evidence Package), and a scripted Responses API client.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { stringify as stringifyYaml } from "yaml";
import type { CheckManifest } from "./manifest.js";
import type { Review, ResponsesClient } from "./review.js";
import type { EvidencePackage, StageInvocation } from "./types.js";

/** The shell the tests drive. Windows' own bash.exe is WSL, so Git Bash is used there. */
export function testShell(): string {
  if (process.env.EVALUATOR_SHELL) return process.env.EVALUATOR_SHELL;
  if (process.platform === "win32") {
    const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
    if (existsSync(gitBash)) return gitBash;
  }
  return "bash";
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd,
    encoding: "utf8",
    // Capture stderr so Git's progress chatter does not pollute test output; failures still throw with it.
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fileUrl(path: string): string {
  return pathToFileURL(path).href;
}

/** Writes exact bytes, creating parent directories. */
export function writeBytes(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, Buffer.from(content, "utf8"));
}

export interface ScenarioOptions {
  /** Trusted check commands written into the manifest. */
  checks?: Record<string, string>;
  /** required_validation in the Work Contract; defaults to every manifest check. */
  requiredValidation?: { name: string; command: string }[];
  setup?: string[];
  /** The candidate's greeting; the default satisfies the acceptance criterion. */
  candidateGreeting?: string;
  /** Overrides applied to the Evidence Package before it is committed. */
  evidence?: Partial<EvidencePackage>;
  /** Names this commit as the candidate in the Evidence Package instead of the real one. */
  candidateSha?: string;
}

export interface Scenario {
  root: string;
  product: TestRemote;
  intents: TestRemote;
  base: string;
  specCommit: string;
  candidate: string;
  /** The branch tip carrying the Evidence Package; the invocation's target. */
  handoff: string;
  invocation: StageInvocation;
  manifest: CheckManifest;
  intentText: string;
  profileText: string;
}

export const INTENT_ID = "INT-T-0001";
export const WORK = `.agent/work/${INTENT_ID}`;
export const BRANCH = `work/${INTENT_ID}`;

/**
 * Builds the state the SDLC hands to Evaluation: frozen copies, accepted spec and Work
 * Contract v3, a candidate commit, and the Coding Agent's Evidence Package after it.
 */
export function buildScenario(options: ScenarioOptions = {}): Scenario {
  const root = tempDir("scenario-");
  const intents = new TestRemote(root, "intent-backlog");
  const product = new TestRemote(root, "product");
  const intentText = "# Intent\r\n\r\nShow a greeting on the home page.\r\n";
  const profileText = "# Policy & Compliance Profile\n\nProfile ID: `T-DEFAULT`\n\nVersion: `1`\n";
  // Only so the freeze references name a real commit; the evaluator never reads it.
  const intentCommit = intents.commit(
    {
      "products/t/intents/INT-T-0001/intent.md": intentText,
      "products/t/policy-profiles/T-DEFAULT.md": profileText,
    },
    "intent v1",
  );

  const base = product.commit(
    { "README.md": "# Product\n", "src/greeting.txt": "hello\n", "AGENTS.md": "Product instructions.\n" },
    "base",
  );
  product.branchFrom(base, BRANCH);

  const checks = options.checks ?? { build: "grep -q 'hello, world' src/greeting.txt" };
  const requiredValidation =
    options.requiredValidation ?? Object.entries(checks).map(([name, command]) => ({ name, command }));
  const workItem = { product_id: "T", intent_id: INTENT_ID, intent_version: 1, trello_card_id: "card-t" };
  const intentRef = {
    repository: intents.url,
    commit_sha: intentCommit,
    path: "products/t/intents/INT-T-0001/intent.md",
    sha256: sha256(intentText),
  };
  const profileRef = {
    repository: intents.url,
    commit_sha: intentCommit,
    path: "products/t/policy-profiles/T-DEFAULT.md",
    sha256: sha256(profileText),
  };
  const contract = {
    schema_version: 3,
    work_item: workItem,
    intent: intentRef,
    policy_profile_id: "T-DEFAULT",
    policy_profile_version: "1",
    policy_profile: profileRef,
    target: { repository: product.url, commit_sha: base },
    acceptance_criteria: ["The greeting reads 'hello, world'."],
    permitted_scope: { included: ["Greeting text"], excluded: ["Anything else"] },
    required_validation: requiredValidation,
    policy_controls: [],
    release_requirements: [],
    observation_requirements: [],
  };
  const specText = "# Spec\n\n## Outcome and scope\n\nChange the greeting to 'hello, world'.\n";
  const contractText = stringifyYaml(contract);
  const specCommit = product.commit(
    {
      [`${WORK}/intent.md`]: intentText,
      [`${WORK}/policy-profile.md`]: profileText,
      [`${WORK}/spec.md`]: specText,
      [`${WORK}/work-contract.yaml`]: contractText,
    },
    "spec and contract accepted",
    BRANCH,
  );
  const specRef = {
    repository: product.url,
    commit_sha: specCommit,
    path: `${WORK}/spec.md`,
    sha256: sha256(specText),
  };
  const contractRef = {
    repository: product.url,
    commit_sha: specCommit,
    path: `${WORK}/work-contract.yaml`,
    sha256: sha256(contractText),
  };

  const candidate = product.commit(
    { "src/greeting.txt": `${options.candidateGreeting ?? "hello, world"}\n` },
    "candidate",
    BRANCH,
  );
  const evidence: EvidencePackage = {
    schema_version: "1.0",
    work_item: workItem,
    input_artifacts: [intentRef, profileRef, specRef, contractRef],
    candidate: { repository: product.url, commit_sha: options.candidateSha ?? candidate },
    changed_paths: ["src/greeting.txt"],
    validation: requiredValidation.map((r) => ({
      name: r.name,
      outcome: "passed",
      observed_at: "2026-10-31T10:00:00Z",
      summary: "Coding Agent observed exit 0.",
    })),
    policy_control_evidence: [],
    status: "candidate_complete",
    summary: "Changed the greeting.",
    ...options.evidence,
  };
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidencePath = `${WORK}/evidence-package/inv-exec-1.json`;
  const handoff = product.commit({ [evidencePath]: evidenceText }, "evidence", BRANCH);

  const invocation: StageInvocation = {
    schema_version: "1.1",
    invocation_id: "inv-eval-1",
    trigger_event_id: "evt-eval-1",
    stage: "evaluation",
    work_item: workItem,
    freeze_activation: {
      schema_version: "1.0",
      event_id: "freeze-t-1",
      event_type: "activated",
      work_item: workItem,
      intent: intentRef,
      policy_profile_id: "T-DEFAULT",
      policy_profile_version: "1",
      policy_profile: profileRef,
      authorized_by: "owner-t",
      recorded_at: "2026-10-27T10:00:00Z",
    },
    input_artifacts: [
      specRef,
      contractRef,
      { repository: product.url, commit_sha: handoff, path: evidencePath, sha256: sha256(evidenceText) },
    ],
    target: { repository: product.url, commit_sha: handoff },
    workspace_ref: BRANCH,
    read_paths: ["."],
    write_paths: [`${WORK}/evaluation-package`],
  };
  const manifest: CheckManifest = {
    repositories: [{ url: product.url, setup: options.setup ?? [], checks }],
    intent_repositories: [intents.url],
  };
  return {
    root,
    product,
    intents,
    base,
    specCommit,
    candidate,
    handoff,
    invocation,
    manifest,
    intentText,
    profileText,
  };
}

/**
 * A bare repository acting as the remote, plus a scratch clone used to author commits.
 * `uploadpack.allowAnySHA1InWant` mirrors GitHub, which serves any reachable commit by SHA.
 */
export class TestRemote {
  readonly bare: string;
  readonly author: string;
  readonly url: string;

  constructor(
    readonly root: string,
    name: string,
  ) {
    this.bare = join(root, `${name}.git`);
    this.author = join(root, `${name}-author`);
    mkdirSync(this.bare, { recursive: true });
    git(this.bare, ["init", "--bare", "--initial-branch=main"]);
    git(this.bare, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
    mkdirSync(this.author, { recursive: true });
    git(this.author, ["init", "--quiet", "--initial-branch=main"]);
    git(this.author, ["remote", "add", "origin", this.bare]);
    this.url = fileUrl(this.bare);
  }

  commit(files: Record<string, string>, message: string, branch = "main"): string {
    git(this.author, ["checkout", "-B", branch]);
    for (const [path, content] of Object.entries(files)) writeBytes(this.author, path, content);
    git(this.author, ["add", "-A"]);
    git(this.author, ["commit", "--allow-empty", "-m", message]);
    git(this.author, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
    return git(this.author, ["rev-parse", "HEAD"]);
  }

  branchFrom(base: string, branch: string): void {
    git(this.author, ["checkout", "-B", branch, base]);
    git(this.author, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
  }

  tip(branch: string): string {
    return git(this.bare, ["rev-parse", `refs/heads/${branch}`]);
  }

  show(commit: string, path: string): string {
    return git(this.bare, ["show", `${commit}:${path}`]);
  }
}

/** A completed Responses API turn holding the given output items. */
export function responseOf(
  output: unknown[],
  usage = { input_tokens: 1000, output_tokens: 100 },
): Record<string, unknown> {
  return { id: "resp", status: "completed", model: "gpt-6.1-sol", output, usage };
}

export function functionCall(callId: string, name: string, args: unknown): Record<string, unknown> {
  return { type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) };
}

export function verdictMessage(review: Review | Record<string, unknown>): Record<string, unknown> {
  return { type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(review) }] };
}

export const passingReview: Review = {
  status: "pass",
  summary: "The greeting now reads hello, world.",
  acceptance_criteria: [{ index: 0, verdict: "satisfied", evidence: "src/greeting.txt reads hello, world." }],
  findings: [],
  decisions_needed: [],
};

/** Replays fixed responses and records the request bodies it was sent. */
export class ScriptedResponses implements ResponsesClient {
  readonly requests: Record<string, unknown>[] = [];
  constructor(
    private readonly script: (Record<string, unknown> | ((signal: AbortSignal) => Promise<Record<string, unknown>>))[],
  ) {}
  async send(body: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    this.requests.push(structuredClone(body));
    const next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    return typeof next === "function" ? next(signal) : next;
  }
}
