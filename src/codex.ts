import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexExecutionEnvironment, codexFailureMessage } from "./codex-runtime.js";

export async function runCodex(repo: string, prompt: string, acceptanceCriteria: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "evaluator-agent-"));
  const outputFile = join(dir, "last-message.txt");
  const outputSchema = fileURLToPath(new URL("../schemas/evaluation-result.schema.json", import.meta.url));

  try {
    const schema = JSON.parse(await readFile(outputSchema, "utf8")) as { properties: { acceptanceCriteria: { required: string[]; properties: Record<string, unknown> } } };
    schema.properties.acceptanceCriteria.required = acceptanceCriteria;
    schema.properties.acceptanceCriteria.properties = Object.fromEntries(acceptanceCriteria.map((id) => [id, {
      type: "object", additionalProperties: false, required: ["status", "evidence", "explanation"],
      properties: { status: { enum: ["pass", "fail", "partial", "not_verified"] }, evidence: { type: "array", items: { type: "string" } }, explanation: { type: "string" } },
    }]));
    const runtimeSchema = join(dir, "evaluation-result.schema.json");
    await writeFile(runtimeSchema, JSON.stringify(schema), "utf8");
    const args = [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--json",
      "--output-schema",
      runtimeSchema,
      "--output-last-message",
      outputFile,
      "-C",
      repo,
      prompt,
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"], env: codexExecutionEnvironment() });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(codexFailureMessage(code ?? 1, stdout, stderr)));
      });
    });

    return await readFile(outputFile, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
