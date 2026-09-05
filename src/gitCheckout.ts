// ABOUTME: Creates and removes request-scoped Git checkouts for remote evaluator jobs.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitCheckoutRequest {
  repositoryUrl: string;
  allowedRepositoryUrl: string;
  revision: string;
  intentPath: string;
  contractPath: string;
  evidencePath: string;
}

export interface GitCheckout {
  repositoryPath: string;
  intentPath: string;
  contractPath: string;
  evidencePath: string;
  cleanup: () => Promise<void>;
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
  if (request.repositoryUrl !== request.allowedRepositoryUrl) throw new Error("Evaluation request repository is not allowed by this evaluator deployment");
  if (!/^[0-9a-f]{40}$/i.test(request.revision)) throw new Error("Evaluation request revision must be a 40-character Git commit SHA");

  const root = await mkdtemp(join(tmpdir(), "evaluator-job-"));
  const repositoryPath = join(root, "repository");
  try {
    await execFileAsync("git", ["clone", "--no-checkout", request.repositoryUrl, repositoryPath], { windowsHide: true });
    await execFileAsync("git", ["checkout", "--detach", request.revision], { cwd: repositoryPath, windowsHide: true });
    return {
      repositoryPath,
      intentPath: repositoryFile(repositoryPath, request.intentPath),
      contractPath: repositoryFile(repositoryPath, request.contractPath),
      evidencePath: repositoryFile(repositoryPath, request.evidencePath),
      cleanup: async () => { await rm(root, { recursive: true, force: true }); },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
