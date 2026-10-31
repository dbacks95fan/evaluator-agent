// ABOUTME: Creates and removes request-scoped Git checkouts for remote evaluator jobs.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitCheckoutRequest {
  repositoryUrl: string;
  allowedRepositoryUrls: string[];
  branch: string;
  revision: string;
  branchRevision: string;
  intentPath: string;
  contractPath: string;
  contractText: string;
  evidencePath: string;
  evidenceText: string;
  githubToken: string;
}

export interface GitCheckout {
  rootPath: string;
  repositoryPath: string;
  repositoryUrl: string;
  intentPath: string;
  contractPath: string;
  evidencePath: string;
  branch: string;
  revision: string;
  branchRevision: string;
  cleanup: () => Promise<void>;
}

export interface EvaluationPackagePublishRequest {
  checkout: GitCheckout;
  githubToken: string;
  workItem: string;
  packagePath: string;
  packageText: string;
}

export interface EvaluationPackageReference {
  repositoryUrl: string;
  repositoryPath: string;
  branch: string;
  candidateRevision: string;
  packageRevision: string;
  path: string;
  sha256: string;
}

function gitEnvironment(token: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    EVALUATOR_GITHUB_TOKEN: token,
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "credential.https://github.com.username",
    GIT_CONFIG_VALUE_1: "x-access-token",
    GIT_CONFIG_KEY_2: "credential.https://github.com.helper",
    GIT_CONFIG_VALUE_2: '!f(){ echo username=x-access-token; echo "password=$EVALUATOR_GITHUB_TOKEN"; };f',
  };
}

async function git(args: string[], cwd: string, token: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, env: gitEnvironment(token), windowsHide: true });
  return stdout.trim();
}

// ABOUTME: Rejects absolute and traversal paths before they reach the temporary checkout.
function repositoryFile(repositoryPath: string, path: string): string {
  if (!path || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.split(/[\\/]+/).includes("..")) {
    throw new Error("Evaluation artifact paths must be repository-relative and may not escape the checkout");
  }
  const candidate = resolve(repositoryPath, path);
  if (candidate !== repositoryPath && !candidate.startsWith(repositoryPath + sep)) throw new Error("Evaluation artifact path escapes the checkout");
  return candidate;
}

// ABOUTME: Clones an allowed repository without invoking a shell or retaining the checkout after the request.
export async function checkoutEvaluationRevision(request: GitCheckoutRequest): Promise<GitCheckout> {
  if (!request.allowedRepositoryUrls.includes(request.repositoryUrl)) throw new Error("Evaluation request repository is not allowed by this evaluator deployment");
  if (!/^[0-9a-f]{40}$/i.test(request.revision) || !/^[0-9a-f]{40}$/i.test(request.branchRevision)) throw new Error("Evaluation request revisions must be 40-character Git commit SHAs");
  if (!request.githubToken) throw new Error("Evaluator GitHub App installation token is required for repository access.");
  if (["main", "master", "trunk"].includes(request.branch.toLowerCase())) throw new Error("Evaluator may not publish an Evaluation Package to the repository default branch.");

  const root = await mkdtemp(join(tmpdir(), "evaluator-job-"));
  const repositoryPath = join(root, "repository");
  try {
    await git(["check-ref-format", "--branch", request.branch], root, request.githubToken);
    await git(["clone", "--no-checkout", request.repositoryUrl, repositoryPath], root, request.githubToken);
    await git(["fetch", "origin", `+refs/heads/${request.branch}:refs/remotes/origin/${request.branch}`], repositoryPath, request.githubToken);
    const branchRevision = await git(["rev-parse", `refs/remotes/origin/${request.branch}`], repositoryPath, request.githubToken);
    if (branchRevision !== request.branchRevision) throw new Error("The candidate branch no longer points to the supplied Evidence Package revision.");
    await git(["merge-base", "--is-ancestor", request.revision, branchRevision], repositoryPath, request.githubToken);
    await git(["checkout", "--detach", request.revision], repositoryPath, request.githubToken);
    const inputDirectory = join(root, "input");
    await mkdir(inputDirectory, { recursive: true });
    const contractPath = join(inputDirectory, "work-contract.yaml");
    const evidencePath = join(inputDirectory, "evidence-package.json");
    await writeFile(contractPath, request.contractText, { encoding: "utf8", mode: 0o600 });
    await writeFile(evidencePath, request.evidenceText, { encoding: "utf8", mode: 0o600 });
    return {
      rootPath: root,
      repositoryPath,
      repositoryUrl: request.repositoryUrl,
      intentPath: repositoryFile(repositoryPath, request.intentPath),
      contractPath,
      evidencePath,
      branch: request.branch,
      revision: request.revision,
      branchRevision: request.branchRevision,
      cleanup: async () => { await rm(root, { recursive: true, force: true }); },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/** Publish one Evaluation Package commit without changing the immutable candidate commit. */
export async function publishEvaluationPackage(request: EvaluationPackagePublishRequest): Promise<EvaluationPackageReference> {
  const { checkout, githubToken, workItem, packagePath, packageText } = request;
  if (!githubToken) throw new Error("Evaluator GitHub App installation token is required to publish the Evaluation Package.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(workItem)) throw new Error("Evaluation work item contains unsupported path characters.");
  const expectedPath = `.agent/work/${workItem}/evaluation-package/evaluation.json`;
  if (packagePath !== expectedPath) throw new Error(`Evaluation Package path must be ${expectedPath}.`);
  const path = repositoryFile(checkout.repositoryPath, packagePath);
  const head = await git(["rev-parse", "HEAD"], checkout.repositoryPath, githubToken);
  if (head !== checkout.revision) throw new Error("Evaluator checkout moved away from the immutable candidate revision.");
  const initialStatus = await git(["status", "--porcelain", "--untracked-files=all"], checkout.repositoryPath, githubToken);
  if (initialStatus) throw new Error("Evaluator checkout is not clean before Evaluation Package publication.");

  await git(["checkout", "-B", "evaluator-package", `refs/remotes/origin/${checkout.branch}`], checkout.repositoryPath, githubToken);
  const publishBase = await git(["rev-parse", "HEAD"], checkout.repositoryPath, githubToken);
  if (publishBase !== checkout.branchRevision) throw new Error("The Evaluation Package must be based on the branch's immutable Evidence Package revision.");

  await mkdir(join(checkout.repositoryPath, ".agent", "work", workItem, "evaluation-package"), { recursive: true });
  await writeFile(path, packageText, { encoding: "utf8", mode: 0o644 });
  await git(["config", "user.name", "Evaluator Agent"], checkout.repositoryPath, githubToken);
  await git(["config", "user.email", "evaluator@agentic-sdlc.local"], checkout.repositoryPath, githubToken);
  await git(["add", "--force", "--", packagePath], checkout.repositoryPath, githubToken);
  const stagedPaths = await git(["diff", "--cached", "--name-only"], checkout.repositoryPath, githubToken);
  if (stagedPaths !== packagePath) throw new Error("Evaluator may stage only the assigned Evaluation Package path.");
  await git(["commit", "-m", `chore(agent): evaluation package for ${workItem} at ${checkout.revision.slice(0, 12)}`], checkout.repositoryPath, githubToken);
  const committedPaths = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], checkout.repositoryPath, githubToken);
  if (committedPaths !== packagePath) throw new Error("Evaluator commit changed files outside the assigned Evaluation Package path.");
  const packageRevision = await git(["rev-parse", "HEAD"], checkout.repositoryPath, githubToken);
  await git(["push", "origin", `HEAD:refs/heads/${checkout.branch}`], checkout.repositoryPath, githubToken);
  return {
    repositoryUrl: checkout.repositoryUrl,
    repositoryPath: checkout.repositoryPath,
    branch: checkout.branch,
    candidateRevision: checkout.revision,
    packageRevision,
    path: packagePath,
    sha256: createHash("sha256").update(packageText, "utf8").digest("hex"),
  };
}
