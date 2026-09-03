import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "./log.js";

export interface CodexCanaryResult {
  output: string;
  durationMs: number;
}

function humanizeCanaryFailure(error: unknown): Error {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("api key") || lower.includes("authentication")) {
    return new Error(`Codex authentication failed. Confirm OPENAI_API_KEY is valid, active, and available to the evaluator container. Details: ${message}`);
  }
  return new Error(`Codex authentication canary did not complete. Confirm the NAS can reach OpenAI and review the evaluator container logs. Details: ${message}`);
}

export async function runCodexAuthenticationCanary(): Promise<CodexCanaryResult> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "evaluator-canary-"));
  const outputFile = join(dir, "last-message.json");
  const outputSchema = fileURLToPath(new URL("../schemas/codex-auth-canary.schema.json", import.meta.url));

  try {
    const args = ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--output-schema", outputSchema, "--output-last-message", outputFile, "-C", "/tmp", "Return exactly this JSON object: {\"status\":\"authenticated\"}. Do not access files or run commands."];
    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", args, { cwd: "/tmp", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: "/tmp", CODEX_HOME: "/tmp/.codex" } });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`codex exec exited ${code}: ${stderr.slice(-2000)}`)));
    });
    const output = await readFile(outputFile, "utf8");
    const parsed = JSON.parse(output) as { status?: unknown };
    if (parsed.status !== "authenticated") throw new Error("Codex returned an unexpected canary response");
    return { output, durationMs: Date.now() - started };
  } catch (error) {
    throw humanizeCanaryFailure(error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
