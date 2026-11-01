// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Integration tests for a full Evaluation run against real Git remotes with a scripted model.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "./config.js";
import { validateRecord } from "./lifecycle.js";
import { silentLogger } from "./log.js";
import type { Review } from "./review.js";
import { executeEvaluation, type RunOutcome } from "./run.js";
import {
  BRANCH,
  buildScenario,
  functionCall,
  git,
  passingReview,
  removeDir,
  responseOf,
  ScriptedResponses,
  sha256,
  testShell,
  verdictMessage,
  WORK,
  type Scenario,
  type ScenarioOptions,
} from "./testSupport.js";

async function run(
  scenario: Scenario,
  model: ScriptedResponses,
  env: Record<string, string> = {},
): Promise<RunOutcome> {
  const config = loadConfig({
    EVALUATOR_SHELL: testShell(),
    EVALUATOR_WORK_ROOT: join(scenario.root, "work"),
    EVALUATOR_MAX_TURNS: "6",
    ...env,
  });
  return executeEvaluation(scenario.invocation, { config, manifest: scenario.manifest, model, log: silentLogger });
}

function withScenario(name: string, options: ScenarioOptions, body: (scenario: Scenario) => Promise<void>): void {
  test(name, async () => {
    const scenario = buildScenario(options);
    try {
      await body(scenario);
    } finally {
      removeDir(scenario.root);
    }
  });
}

const verdict = (review: Partial<Review> = {}) => responseOf([verdictMessage({ ...passingReview, ...review })]);

function publishedPackage(scenario: Scenario, outcome: RunOutcome): Record<string, unknown> {
  const ref = outcome.stageResult!.output_artifacts[0];
  const text = scenario.product.show(ref.commit_sha, ref.path) + "\n";
  assert.equal(sha256(text), ref.sha256);
  return JSON.parse(text) as Record<string, unknown>;
}

withScenario(
  "a passing evaluation publishes its package after the evidence, leaving the candidate untouched",
  {},
  async (scenario) => {
    const model = new ScriptedResponses([responseOf([functionCall("c1", "show_diff", { path: null })]), verdict()]);
    const outcome = await run(scenario, model);
    const result = outcome.stageResult!;
    assert.equal(result.status, "pass", JSON.stringify(outcome.diagnostics));
    assert.equal(validateRecord("StageResult", result).valid, true);
    assert.equal(result.invocation_id, scenario.invocation.invocation_id);
    assert.equal(result.stage, "evaluation");
    assert.deepEqual(result.candidate, { repository: scenario.product.url, commit_sha: scenario.candidate });

    const ref = result.output_artifacts[0];
    assert.equal(ref.path, `${WORK}/evaluation-package/inv-eval-1.json`);
    assert.equal(scenario.product.tip(BRANCH), ref.commit_sha);
    assert.equal(git(scenario.product.bare, ["rev-parse", `${ref.commit_sha}^`]), scenario.handoff);
    assert.equal(
      git(scenario.product.bare, ["diff", "--name-only", scenario.handoff, ref.commit_sha]),
      `${WORK}/evaluation-package/inv-eval-1.json`,
    );

    const pkg = publishedPackage(scenario, outcome);
    assert.equal(validateRecord("EvaluationPackage", pkg).valid, true);
    assert.equal(pkg.status, "pass");
    assert.deepEqual(pkg.candidate, { repository: scenario.product.url, commit_sha: scenario.candidate });
    assert.equal((pkg.checks as { outcome: string }[])[0].outcome, "passed");
    assert.equal((pkg.input_artifacts as unknown[]).length, 5);

    // The model saw the observed check results and a diff of the product change only.
    const first = model.requests[0] as { input: { content: string }[]; store: boolean };
    assert.equal(first.store, false);
    assert.match(first.input[0].content, /- build: passed/);
    const diffOutput = (model.requests[1] as { input: { type?: string; output?: string }[] }).input.find(
      (item) => item.type === "function_call_output",
    )!.output!;
    assert.match(diffOutput, /\+hello, world/);
    assert.doesNotMatch(diffOutput, /\.agent\//);
  },
);

withScenario(
  "a candidate that fails the rerun check fails evaluation even when the model and evidence say otherwise",
  { candidateGreeting: "goodbye" },
  async (scenario) => {
    const outcome = await run(scenario, new ScriptedResponses([verdict()]));
    const result = outcome.stageResult!;
    assert.equal(result.status, "fail");
    const pkg = publishedPackage(scenario, outcome);
    const findings = pkg.findings as { category: string; severity: string; summary: string }[];
    assert.equal(findings[0].category, "implementation");
    assert.equal(findings[0].severity, "blocking");
    assert.ok(findings.some((f) => f.category === "evidence"));
    assert.match(result.findings!.join(" "), /Required check build failed when the Evaluator reran it/);
  },
);

withScenario("a specification defect is published as a blocking specification finding", {}, async (scenario) => {
  const outcome = await run(
    scenario,
    new ScriptedResponses([
      verdict({
        status: "fail",
        findings: [
          {
            category: "specification",
            severity: "blocking",
            summary: "The spec never defines 'greeting'.",
            path: null,
          },
        ],
      }),
    ]),
  );
  assert.equal(outcome.stageResult!.status, "fail");
  const findings = publishedPackage(scenario, outcome).findings as { category: string }[];
  assert.deepEqual(
    findings.map((f) => f.category),
    ["specification"],
  );
});

withScenario("a needed decision is published and held", {}, async (scenario) => {
  const outcome = await run(
    scenario,
    new ScriptedResponses([
      verdict({
        status: "needs_decision",
        decisions_needed: [
          { question: "Should the greeting be localized?", options: ["yes", "no"], recommendation: "no" },
        ],
      }),
    ]),
  );
  assert.equal(outcome.stageResult!.status, "needs_decision");
  assert.match(outcome.stageResult!.findings!.join(" "), /Should the greeting be localized\?/);
  assert.equal(publishedPackage(scenario, outcome).status, "needs_decision");
});

withScenario("a review that hits its turn limit is blocked and nothing is pushed", {}, async (scenario) => {
  const looping = Array.from({ length: 6 }, (_, i) =>
    responseOf([functionCall(`c${i}`, "list_directory", { path: "." })]),
  );
  const outcome = await run(scenario, new ScriptedResponses(looping));
  assert.equal(outcome.stageResult!.status, "blocked");
  assert.equal(outcome.evaluationPackage, null);
  assert.equal(scenario.product.tip(BRANCH), scenario.handoff);
});

withScenario("a branch that moves during the evaluation blocks the push", {}, async (scenario) => {
  const model = new ScriptedResponses([
    async () => {
      scenario.product.commit({ "src/late.txt": "late" }, "late writer", BRANCH);
      return verdict();
    },
  ]);
  const outcome = await run(scenario, model);
  assert.equal(outcome.stageResult!.status, "blocked");
  assert.match(outcome.stageResult!.findings!.join(" "), /moved .* during the evaluation/);
});

withScenario("an inadmissible invocation is blocked before any check or model call", {}, async (scenario) => {
  scenario.invocation.stage = "execution";
  const model = new ScriptedResponses([]);
  const outcome = await run(scenario, model);
  assert.equal(outcome.stageResult!.status, "blocked");
  assert.equal(outcome.stageResult!.stage, "execution");
  assert.equal(model.requests.length, 0);
});

test("an uncorrelatable request returns no StageResult", async () => {
  const config = loadConfig({ EVALUATOR_SHELL: testShell() });
  const outcome = await executeEvaluation(
    { hello: "world" },
    {
      config,
      manifest: { repositories: [], intent_repositories: [] },
      model: new ScriptedResponses([]),
      log: silentLogger,
    },
  );
  assert.equal(outcome.stageResult, null);
});
