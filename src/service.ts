import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import { runCodexAuthenticationCanary } from "./canary.js";
import { errorMessage, log } from "./log.js";

const port = Number(process.env.PORT ?? "8080");
const token = process.env.EVALUATOR_API_TOKEN;
const inputRoot = resolve(process.env.EVALUATOR_INPUT_ROOT ?? "/jobs/input");
const outputRoot = resolve(process.env.EVALUATOR_OUTPUT_ROOT ?? "/jobs/output");
if (!token) throw new Error("EVALUATOR_API_TOKEN is required");

interface EvaluationRequest { workItem: string; intentPath: string; contractPath: string; evidencePath: string; repoPath: string; resultPath?: string; }
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

function authorized(header: string | undefined): boolean { return header === `Bearer ${token}`; }
function json(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function dashboard(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evaluator deployment status</title><style>body{font:16px system-ui,sans-serif;margin:2rem;max-width:780px;color:#172033}h1{margin-bottom:.25rem}.card{border:1px solid #c8d0dc;border-radius:10px;padding:1.25rem;margin-top:1.25rem}.status{font-weight:700}.pass{color:#117a37}.fail{color:#b42318}.running{color:#8a5a00}.not_run{color:#475467}</style></head><body><h1>Evaluator deployment status</h1><p>This page shows in-memory status only. It resets when the stateless container restarts.</p><div class="card"><h2 id="name">Loading...</h2><p><strong>What:</strong> <span id="name2"></span></p><p><strong>How:</strong> <span id="how"></span></p><p><strong>State:</strong> <span id="status" class="status"></span></p><p><strong>Started:</strong> <span id="started"></span></p><p><strong>Finished:</strong> <span id="finished"></span></p><p><strong>Result:</strong> <span id="message"></span></p></div><script>async function load(){const r=await fetch('/deployment-tests/latest',{cache:'no-store'});const x=await r.json();document.getElementById('name').textContent=x.name;document.getElementById('name2').textContent=x.name;document.getElementById('how').textContent=x.how;document.getElementById('started').textContent=x.startedAt||'—';document.getElementById('finished').textContent=x.finishedAt||'—';document.getElementById('message').textContent=x.message;const s=document.getElementById('status');s.textContent=x.status;s.className='status '+x.status;}load();setInterval(load,2000);</script></body></html>`;
}

async function review(job: EvaluationRequest, requestId: string): Promise<{ statusCode: number; output: string }> {
  if (!job.workItem || !job.intentPath || !job.contractPath || !job.evidencePath || !job.repoPath) throw new Error("workItem, intentPath, contractPath, evidencePath, and repoPath are required");
  const intent = scopedPath(inputRoot, job.intentPath);
  const contract = scopedPath(inputRoot, job.contractPath);
  const evidence = scopedPath(inputRoot, job.evidencePath);
  const repo = scopedPath(inputRoot, job.repoPath);
  await Promise.all([access(intent), access(contract), access(evidence), access(repo)]);
  const started = Date.now();
  log("info", "evaluation.started", "Evaluator accepted an authenticated evaluation request.", { requestId, workItem: job.workItem });
  const output = await new Promise<{ statusCode: number; output: string }>((resolvePromise, reject) => {
    const child = spawn("node", ["/app/dist/cli.js", "review", "--intent", intent, "--contract", contract, "--evidence", evidence, "--repo", repo], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += String(data); });
    child.stderr.on("data", (data) => { stderr += String(data); });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ statusCode: code ?? 1, output: stdout || stderr }));
  });
  if (job.resultPath) { const result = scopedPath(outputRoot, job.resultPath); await mkdir(resolve(result, ".."), { recursive: true }); await writeFile(result, output.output, "utf8"); }
  log(output.statusCode === 0 ? "info" : "warn", "evaluation.completed", "Evaluator finished an evaluation request.", { requestId, workItem: job.workItem, exitCode: output.statusCode, durationMs: Date.now() - started });
  return output;
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
    if (body.length > 128_000) throw new Error("Request body is too large");
    const result = await review(JSON.parse(body) as EvaluationRequest, requestId);
    return json(response, result.statusCode === 0 ? 200 : 422, result.output);
  } catch (error) {
    const message = errorMessage(error); log("error", "evaluation.failed", "Evaluator could not complete the evaluation request.", { requestId, error: message }); return json(response, 400, { status: "error", error: message });
  }
});
server.listen(port, "0.0.0.0", () => log("info", "service.started", "Evaluator service is listening.", { port, inputRoot, outputRoot }));
