#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { buildEvaluationPrompt } from "./prompt.js";
import { extractJsonObject, readStructuredFile } from "./io.js";
import { runCodex } from "./codex.js";
import { verifyHandoff } from "./integrity.js";
import { readIntent } from "./intent.js";
import { validateEvaluation } from "./validate.js";
import type { EvidencePackage, WorkContract } from "./types.js";

function usage(): never {
  console.error("Usage: evaluator-agent review --intent <file> --contract <file> --evidence <file> --repo <candidate-worktree>");
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
  const intentPath = resolve(option(args, "--intent"));
  const evidencePath = resolve(option(args, "--evidence"));
  const repo = resolve(option(args, "--repo"));

  await Promise.all([access(intentPath), access(contractPath), access(evidencePath), access(repo)]);

  const contract = await readStructuredFile<WorkContract>(contractPath);
  const evidence = await readStructuredFile<EvidencePackage>(evidencePath);

  if (contract.schema_version !== 3 || !contract.work_item?.intent_id || !contract.intent?.sha256 || !contract.target?.repository || !Array.isArray(contract.acceptance_criteria) || !Array.isArray(contract.required_validation)) {
    throw new Error("Invalid Work Contract v3: required work_item, intent, target, acceptance_criteria, and required_validation fields are missing");
  }
  if (contract.acceptance_criteria.length === 0) {
    throw new Error("Invalid Work Contract: at least one acceptance criterion is required");
  }
  if (evidence.schema_version !== "1.0" || evidence.status !== "candidate_complete" || !evidence.candidate?.commit_sha) {
    throw new Error("Invalid Evidence Package: a schema_version 1.0 candidate_complete package is required");
  }

  await verifyHandoff(contractPath, intentPath, contract, evidence);

  const intent = await readIntent(intentPath);
  const prompt = buildEvaluationPrompt(contract, evidence, intent, await (await import("./integrity.js")).sha256File(contractPath));
  const raw = await runCodex(repo, prompt, contract.acceptance_criteria.map((_, index) => `AC${index + 1}`));
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
