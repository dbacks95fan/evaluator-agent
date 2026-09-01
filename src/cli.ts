#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { buildEvaluationPrompt } from "./prompt.js";
import { extractJsonObject, readStructuredFile } from "./io.js";
import { runCodex } from "./codex.js";
import { verifyHandoff } from "./integrity.js";
import { validateEvaluation } from "./validate.js";
import type { EvidencePackage, WorkContract } from "./types.js";

function usage(): never {
  console.error("Usage: evaluator-agent review --contract <file> --evidence <file> --repo <candidate-worktree>");
  process.exit(2);
}

function option(args: string[], name: string): string {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) usage();
  return args[i + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] !== "review") usage();

  const contractPath = resolve(option(args, "--contract"));
  const evidencePath = resolve(option(args, "--evidence"));
  const repo = resolve(option(args, "--repo"));

  await Promise.all([access(contractPath), access(evidencePath), access(repo)]);

  const contract = await readStructuredFile<WorkContract>(contractPath);
  const evidence = await readStructuredFile<EvidencePackage>(evidencePath);

  if (!contract.work_item || !contract.objective || !contract.acceptance_criteria) {
    throw new Error("Invalid Work Contract: work_item, objective, and acceptance_criteria are required");
  }
  if (Object.keys(contract.acceptance_criteria).length === 0) {
    throw new Error("Invalid Work Contract: at least one acceptance criterion is required");
  }

  await verifyHandoff(contractPath, contract, evidence);

  const prompt = buildEvaluationPrompt(contract, evidence);
  const raw = await runCodex(repo, prompt);
  const result = validateEvaluation(extractJsonObject(raw), contract);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");

  if (result.status === "fail") process.exitCode = 10;
  else if (result.status === "needs_decision") process.exitCode = 20;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "error", error: message }));
  process.exitCode = 1;
});
