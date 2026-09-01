import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function runCodex(repo: string, prompt: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "evaluator-agent-"));
  const outputFile = join(dir, "last-message.txt");

  try {
    const args = [
      "exec",
      "--sandbox",
      "read-only",
      "--json",
      "--output-last-message",
      outputFile,
      "-C",
      repo,
      prompt,
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`codex exec exited ${code}: ${stderr.slice(-4000)}`));
      });
    });

    return await readFile(outputFile, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
