import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const port = Number(process.env.PORT ?? "8080");
const token = process.env.EVALUATOR_API_TOKEN;
const inputRoot = resolve(process.env.EVALUATOR_INPUT_ROOT ?? "/jobs/input");
const outputRoot = resolve(process.env.EVALUATOR_OUTPUT_ROOT ?? "/jobs/output");
if (!token) throw new Error("EVALUATOR_API_TOKEN is required");

interface EvaluationRequest {
  workItem: string;
  intentPath: string;
  contractPath: string;
  evidencePath: string;
  repoPath: string;
  resultPath?: string;
}

function scopedPath(root: string, value: string): string {
  const path = resolve(root, value);
  if (path !== root && !path.startsWith(root + sep)) throw new Error("Job path escapes its configured root");
  return path;
}

async function review(job: EvaluationRequest): Promise<{ statusCode: number; output: string }> {
  if (!job.workItem || !job.intentPath || !job.contractPath || !job.evidencePath || !job.repoPath) throw new Error("workItem, intentPath, contractPath, evidencePath, and repoPath are required");
  const intent = scopedPath(inputRoot, job.intentPath);
  const contract = scopedPath(inputRoot, job.contractPath);
  const evidence = scopedPath(inputRoot, job.evidencePath);
  const repo = scopedPath(inputRoot, job.repoPath);
  await Promise.all([access(intent), access(contract), access(evidence), access(repo)]);
  const output = await new Promise<{ statusCode: number; output: string }>((resolvePromise, reject) => {
    const child = spawn("node", ["/app/dist/cli.js", "review", "--intent", intent, "--contract", contract, "--evidence", evidence, "--repo", repo], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += String(data); });
    child.stderr.on("data", (data) => { stderr += String(data); });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ statusCode: code ?? 1, output: stdout || stderr }));
  });
  if (job.resultPath) {
    const result = scopedPath(outputRoot, job.resultPath);
    await mkdir(resolve(result, ".."), { recursive: true });
    await writeFile(result, output.output, "utf8");
  }
  return output;
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/evaluations" || request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "error", error: "Unauthorized" }));
    return;
  }
  try {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    if (body.length > 128_000) throw new Error("Request body is too large");
    const result = await review(JSON.parse(body) as EvaluationRequest);
    response.writeHead(result.statusCode === 0 ? 200 : 422, { "Content-Type": "application/json" });
    response.end(result.output);
  } catch (error) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }));
  }
});
server.listen(port, "0.0.0.0", () => console.log(`Evaluator service listening on ${port}`));
