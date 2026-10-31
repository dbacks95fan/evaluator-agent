// ABOUTME: Exposes authenticated, stateless evaluator and deployment-test HTTP endpoints.
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import { runCodexAuthenticationCanary } from "./canary.js";
import { checkoutEvaluationRevision, publishEvaluationPackage } from "./gitCheckout.js";
import { createGitHubAppInstallationToken } from "./githubApp.js";
import { errorMessage, log } from "./log.js";
import type { ArtifactRef, EvaluationFinding, EvaluationStatus, EvidencePackage, WorkItem, WorkContract } from "./types.js";
import { parse as parseYaml } from "yaml";

const port = Number(process.env.PORT ?? "8080");
const token = process.env.EVALUATOR_API_TOKEN;
function normalizeRepositoryUrl(value: string): string {
  return value.trim().replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase();
}

const allowedRepositoryUrls = (process.env.EVALUATOR_ALLOWED_REPOSITORY_URLS ?? process.env.EVALUATOR_ALLOWED_REPOSITORY_URL ?? "")
  .split(",").map(normalizeRepositoryUrl).filter(Boolean);
const githubAppId = process.env.EVALUATOR_GITHUB_APP_ID;
const githubInstallationId = process.env.EVALUATOR_GITHUB_APP_INSTALLATION_ID;
const githubPrivateKeyFile = process.env.EVALUATOR_GITHUB_APP_PRIVATE_KEY_FILE;
if (!token) throw new Error("EVALUATOR_API_TOKEN is required");
if (!allowedRepositoryUrls.length) throw new Error("EVALUATOR_ALLOWED_REPOSITORY_URLS is required");
if (!githubAppId || !githubInstallationId || !githubPrivateKeyFile) throw new Error("Evaluator GitHub App ID, installation ID, and private-key file are required");

interface EvaluationRequest {
  workItem: WorkItem;
  repositoryUrl: string;
  branch: string;
  revision: string;
  branchRevision: string;
  intentRef: ArtifactRef;
  contractRef: ArtifactRef;
  evidenceRef: ArtifactRef;
  intentText: string;
  contractText: string;
  evidenceText: string;
  packagePath: string;
}
interface EvaluationResponse {
  evaluation: Record<string, unknown>;
  evaluationPackage: {
    repositoryUrl: string;
    branch: string;
    candidateRevision: string;
    packageRevision: string;
    path: string;
    sha256: string;
  };
}
interface EvaluationPackageRecord {
  schema_version: "1.0";
  work_item: WorkItem;
  input_artifacts: ArtifactRef[];
  candidate: { repository: string; commit_sha: string };
  checks: EvidencePackage["validation"];
  findings: EvaluationFinding[];
  status: EvaluationStatus | "blocked" | "failed";
  summary: string;
}
interface DeploymentTestState { id: string; name: string; how: string; status: "not_run" | "running" | "pass" | "fail"; startedAt?: string; finishedAt?: string; durationMs?: number; message: string; }

let deploymentTest: DeploymentTestState = {
  id: "not-run",
  name: "Codex authentication canary",
  how: "POST /deployment-tests/codex-auth makes one real, low-scope Codex request using OPENAI_API_KEY.",
  status: "not_run",
  message: "No deployment test has run since this container started.",
};

function scopedPath(root: string, value: string): string {
  const path = resolve(root, value);
  if (path !== root && !path.startsWith(root + sep)) throw new Error("Job path escapes its configured root");
  return path;
}

function artifactRef(value: unknown, repositoryUrl: string): ArtifactRef {
  if (!value || typeof value !== "object") throw new Error("Evaluation request artifact reference is missing.");
  const ref = value as ArtifactRef;
  if (normalizeRepositoryUrl(ref.repository) !== normalizeRepositoryUrl(repositoryUrl) || !/^[0-9a-f]{40}$/i.test(ref.commit_sha) || !/^[0-9a-f]{64}$/i.test(ref.sha256)) {
    throw new Error("Evaluation artifact reference must identify a hashed artifact in the assigned product repository.");
  }
  if (!ref.path || ref.path.startsWith("/") || ref.path.split(/[\\/]/).includes("..")) throw new Error("Evaluation artifact path must be repository-relative.");
  return ref;
}

function packageFindings(evaluation: Record<string, unknown>): EvaluationFinding[] {
  const findings = Array.isArray(evaluation.findings) ? evaluation.findings as Array<Record<string, unknown>> : [];
  return findings.map((finding) => {
    const type = String(finding.type ?? "");
    const category: EvaluationFinding["category"] = type === "security" ? "policy" : type === "evidence" || type === "test_quality" ? "evidence" : type === "specification" ? "specification" : "implementation";
    const severity = ["critical", "high"].includes(String(finding.severity)) ? "blocking" : "non_blocking";
    return { category, severity, summary: String(finding.problem ?? "Evaluator finding") };
  });
}

function authorized(header: string | undefined): boolean { return header === `Bearer ${token}`; }
function json(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function dashboard(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evaluator deployment status</title><style>body{font:16px system-ui,sans-serif;margin:2rem;max-width:780px;color:#172033}h1{margin-bottom:.25rem}.card{border:1px solid #c8d0dc;border-radius:10px;padding:1.25rem;margin-top:1.25rem}.status{font-weight:700}.pass{color:#117a37}.fail{color:#b42318}.running{color:#8a5a00}.not_run{color:#475467}</style></head><body><h1>Evaluator deployment status</h1><p>This page shows in-memory status only. It resets when the stateless container restarts.</p><div class="card"><h2 id="name">Loading...</h2><p><strong>What:</strong> <span id="name2"></span></p><p><strong>How:</strong> <span id="how"></span></p><p><strong>State:</strong> <span id="status" class="status"></span></p><p><strong>Started:</strong> <span id="started"></span></p><p><strong>Finished:</strong> <span id="finished"></span></p><p><strong>Result:</strong> <span id="message"></span></p></div><script>async function load(){const r=await fetch('/deployment-tests/latest',{cache:'no-store'});const x=await r.json();document.getElementById('name').textContent=x.name;document.getElementById('name2').textContent=x.name;document.getElementById('how').textContent=x.how;document.getElementById('started').textContent=x.startedAt||'—';document.getElementById('finished').textContent=x.finishedAt||'—';document.getElementById('message').textContent=x.message;const s=document.getElementById('status');s.textContent=x.status;s.className='status '+x.status;}load();setInterval(load,2000);</script></body></html>`;
}

async function review(job: EvaluationRequest, requestId: string): Promise<{ statusCode: number; response: EvaluationResponse | null; output: string }> {
  if (!job.workItem || !job.repositoryUrl || !job.branch || !job.revision || !job.branchRevision || !job.intentText || !job.contractText || !job.evidenceText || !job.packagePath) throw new Error("workItem, repositoryUrl, branch, revisions, all three artifact texts, and packagePath are required");
  const normalizedRepositoryUrl = normalizeRepositoryUrl(job.repositoryUrl);
  if (!allowedRepositoryUrls.includes(normalizedRepositoryUrl)) throw new Error("Evaluation request repository is not allowed by this evaluator deployment");
  const intentRef = artifactRef(job.intentRef, job.repositoryUrl);
  const contractRef = artifactRef(job.contractRef, job.repositoryUrl);
  const evidenceRef = artifactRef(job.evidenceRef, job.repositoryUrl);
  const intentId = job.workItem.intent_id;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(intentId)) throw new Error("Evaluation work item contains unsupported path characters.");
  const work = `.agent/work/${intentId}`;
  if (job.branch !== `work/${intentId}`) throw new Error("Evaluator may publish only to the assigned work-item branch.");
  if (intentRef.path !== `${work}/intent.md` || contractRef.path !== `${work}/work-contract.yaml` || !evidenceRef.path.startsWith(`${work}/evidence-package/`) || !evidenceRef.path.endsWith(".json")) throw new Error("Evaluation artifact paths do not match the canonical work-item paths.");
  if (job.packagePath !== `${work}/evaluation-package/evaluation.json`) throw new Error(`Evaluation Package path must be ${work}/evaluation-package/evaluation.json.`);
  if (evidenceRef.commit_sha !== job.branchRevision) throw new Error("The branch revision must be the Evidence Package commit.");
  const artifactBytes = [job.intentText, job.contractText, job.evidenceText].reduce((total, value) => total + Buffer.byteLength(value, "utf8"), 0);
  if (artifactBytes > 512_000) throw new Error("Evaluation inputs exceed the 512 KB limit");
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  if (digest(job.intentText) !== intentRef.sha256 || digest(job.contractText) !== contractRef.sha256 || digest(job.evidenceText) !== evidenceRef.sha256) throw new Error("An Evaluation input does not match its immutable artifact hash.");
  const contract = parseYaml(job.contractText) as WorkContract;
  const evidence = JSON.parse(job.evidenceText) as EvidencePackage;
  if (contract.schema_version !== 3 || JSON.stringify(contract.work_item) !== JSON.stringify(job.workItem)) throw new Error("The Work Contract does not match the requested frozen work item.");
  if (evidence.schema_version !== "1.0" || JSON.stringify(evidence.work_item) !== JSON.stringify(job.workItem) || evidence.status !== "candidate_complete") throw new Error("The Evidence Package does not match a completed candidate for this work item.");
  if (normalizeRepositoryUrl(contract.target.repository) !== normalizedRepositoryUrl) throw new Error("The Work Contract target does not match the assigned product repository.");
  if (normalizeRepositoryUrl(evidence.candidate.repository) !== normalizedRepositoryUrl || evidence.candidate.commit_sha !== job.revision) throw new Error("The Evidence Package candidate does not match the requested immutable candidate revision.");
  if (!evidence.input_artifacts.some((ref) => ref.path === contractRef.path && ref.commit_sha === contractRef.commit_sha && ref.sha256 === contractRef.sha256)) throw new Error("The Evidence Package does not identify the accepted Work Contract bytes.");
  const packageStatus = (value: unknown): EvaluationPackageRecord["status"] => {
    if (value === "pass" || value === "fail" || value === "needs_decision") return value;
    return "failed";
  };
  const githubToken = await createGitHubAppInstallationToken({
    appId: githubAppId!, installationId: githubInstallationId!, privateKeyFile: githubPrivateKeyFile!, repositoryUrl: normalizedRepositoryUrl,
    contentsPermission: "read",
  });
  const checkout = await checkoutEvaluationRevision({
    repositoryUrl: normalizedRepositoryUrl,
    allowedRepositoryUrls,
    branch: job.branch,
    revision: job.revision,
    branchRevision: job.branchRevision,
    intentPath: intentRef.path,
    contractPath: contractRef.path,
    contractText: job.contractText,
    evidencePath: evidenceRef.path,
    evidenceText: job.evidenceText,
    githubToken,
  });
  const started = Date.now();
  try {
    await Promise.all([access(checkout.intentPath), access(checkout.contractPath), access(checkout.evidencePath), access(checkout.repositoryPath)]);
    const intentOnCandidate = await readFile(checkout.intentPath, "utf8");
    if (digest(intentOnCandidate) !== intentRef.sha256) throw new Error("The frozen intent copy on the candidate does not match its pinned hash.");
    log("info", "evaluation.started", "Evaluator checked out the requested Git revision for an authenticated evaluation request.", { requestId, workItem: intentId, revision: job.revision });
    const output = await new Promise<{ statusCode: number; output: string }>((resolvePromise, reject) => {
      const child = spawn("node", ["/app/dist/cli.js", "review", "--intent", checkout.intentPath, "--contract", checkout.contractPath, "--evidence", checkout.evidencePath, "--repo", checkout.repositoryPath], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (data) => { stdout += String(data); });
      child.stderr.on("data", (data) => { stderr += String(data); });
      child.on("error", reject);
      child.on("close", (code) => resolvePromise({ statusCode: code ?? 1, output: stdout || stderr }));
    });
    log(output.statusCode === 0 ? "info" : "warn", "evaluation.completed", "Evaluator finished an evaluation request.", { requestId, workItem: intentId, exitCode: output.statusCode, durationMs: Date.now() - started });
    if (![0, 10, 20].includes(output.statusCode)) return { ...output, response: null };
    const evaluation = JSON.parse(output.output) as Record<string, unknown>;
    const packageRecord: EvaluationPackageRecord = {
      schema_version: "1.0",
      work_item: job.workItem,
      input_artifacts: [intentRef, contractRef, ...evidence.input_artifacts, evidenceRef]
        .filter((ref, index, refs) => refs.findIndex((candidate) => candidate.repository === ref.repository && candidate.commit_sha === ref.commit_sha && candidate.path === ref.path && candidate.sha256 === ref.sha256) === index),
      candidate: { repository: normalizedRepositoryUrl, commit_sha: job.revision },
      checks: evidence.validation,
      findings: packageFindings(evaluation),
      status: packageStatus(evaluation.status),
      summary: String(evaluation.summary ?? "Evaluation completed."),
    };
    if (packageRecord.status === "pass" && (packageRecord.checks.length === 0 || packageRecord.checks.some((check) => !["passed", "not_applicable"].includes(check.outcome)) || packageRecord.findings.some((finding) => finding.severity === "blocking"))) {
      throw new Error("The Evaluation Package cannot pass while checks are missing or failed, or blocking findings remain.");
    }
    if (packageRecord.status === "fail" && !packageRecord.findings.some((finding) => finding.severity === "blocking")) {
      throw new Error("A failed Evaluation Package must include at least one blocking finding.");
    }
    const packageText = `${JSON.stringify(packageRecord, null, 2)}\n`;
    const publishToken = await createGitHubAppInstallationToken({
      appId: githubAppId!, installationId: githubInstallationId!, privateKeyFile: githubPrivateKeyFile!, repositoryUrl: normalizedRepositoryUrl,
      contentsPermission: "write",
    });
    const published = await publishEvaluationPackage({
      checkout, githubToken: publishToken, workItem: intentId, packagePath: job.packagePath, packageText,
    });
    const response: EvaluationResponse = {
      evaluation,
      evaluationPackage: {
        repositoryUrl: normalizedRepositoryUrl,
        branch: published.branch,
        candidateRevision: published.candidateRevision,
        packageRevision: published.packageRevision,
        path: published.path,
        sha256: published.sha256,
      },
    };
    return { statusCode: output.statusCode, response, output: JSON.stringify(response) };
  } finally {
    await checkout.cleanup();
    log("info", "evaluation.cleanup", "Evaluator removed the request-scoped Git checkout.", { requestId, workItem: intentId });
  }
}

async function runDeploymentTest(): Promise<DeploymentTestState> {
  if (deploymentTest.status === "running") return deploymentTest;
  const id = randomUUID(); const started = Date.now();
  deploymentTest = { id, name: "Codex authentication canary", how: "POST /deployment-tests/codex-auth makes one real, low-scope Codex request using OPENAI_API_KEY.", status: "running", startedAt: new Date().toISOString(), message: "Running a real Codex authentication request." };
  log("info", "deployment_test.started", "Starting the real Codex authentication canary.", { testId: id });
  try {
    const canary = await runCodexAuthenticationCanary();
    deploymentTest = { ...deploymentTest, status: "pass", finishedAt: new Date().toISOString(), durationMs: canary.durationMs, message: "Codex authenticated successfully and returned the expected canary response." };
    log("info", "deployment_test.passed", "Codex authentication canary passed.", { testId: id, durationMs: canary.durationMs });
  } catch (error) {
    deploymentTest = { ...deploymentTest, status: "fail", finishedAt: new Date().toISOString(), durationMs: Date.now() - started, message: errorMessage(error) };
    log("error", "deployment_test.failed", "Codex authentication canary failed.", { testId: id, durationMs: deploymentTest.durationMs, error: deploymentTest.message });
  }
  return deploymentTest;
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  if (request.method === "GET" && request.url === "/health") return json(response, 200, { status: "ok" });
  if (request.method === "GET" && request.url === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" }); response.end(dashboard()); return; }
  if (request.method === "GET" && request.url === "/deployment-tests/latest") return json(response, 200, deploymentTest);
  log("info", "http.request", "Evaluator received an HTTP request.", { requestId, method: request.method, path: request.url });
  if (!authorized(request.headers.authorization)) { log("warn", "http.unauthorized", "Evaluator rejected a request with missing or invalid credentials.", { requestId, method: request.method, path: request.url }); return json(response, 401, { status: "error", error: "Unauthorized. Provide a valid evaluator bearer token." }); }
  if (request.method === "POST" && request.url === "/deployment-tests/codex-auth") { if (deploymentTest.status === "running") return json(response, 409, deploymentTest); const result = await runDeploymentTest(); return json(response, result.status === "pass" ? 200 : 503, result); }
  if (request.method !== "POST" || request.url !== "/evaluations") return json(response, 404, { status: "error", error: "Not found" });
  try {
    let body = ""; for await (const chunk of request) body += String(chunk);
    if (Buffer.byteLength(body, "utf8") > 600_000) throw new Error("Request body is too large");
    const result = await review(JSON.parse(body) as EvaluationRequest, requestId);
    return json(response, result.response ? 200 : 422, result.response ?? { status: "error", error: result.output });
  } catch (error) {
    const message = errorMessage(error); log("error", "evaluation.failed", "Evaluator could not complete the evaluation request.", { requestId, error: message }); return json(response, 400, { status: "error", error: message });
  }
});
server.listen(port, "0.0.0.0", () => log("info", "service.started", "Evaluator service is listening.", { port, allowedRepositoryCount: allowedRepositoryUrls.length }));
