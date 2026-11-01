// Copyright (c) 2026 DPSystems, LLC.
// ABOUTME: Integration tests for Evaluation preflight against real Git repositories.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { DriverGit } from "./git.js";
import { admitEvaluation, BlockedError } from "./invocation.js";
import { prepareWorkspace } from "./preflight.js";
import { BRANCH, buildScenario, removeDir, WORK, type Scenario, type ScenarioOptions } from "./testSupport.js";

function driverFor(scenario: Scenario): DriverGit {
  return new DriverGit(join(scenario.root, "driver-home"), { name: "evaluator", email: "evaluator@example.com" });
}

async function blockedReasons(scenario: Scenario): Promise<string> {
  const admitted = admitEvaluation(scenario.invocation, scenario.manifest);
  try {
    await prepareWorkspace(admitted, driverFor(scenario), join(scenario.root, "run"));
  } catch (err) {
    assert.ok(err instanceof BlockedError, String(err));
    return err.reasons.join(" ");
  }
  assert.fail("expected preflight to block");
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

withScenario("a consistent handoff is verified and the exact candidate is checked out", {}, async (scenario) => {
  const admitted = admitEvaluation(scenario.invocation, scenario.manifest);
  const driver = driverFor(scenario);
  const verified = await prepareWorkspace(admitted, driver, join(scenario.root, "run"));
  assert.equal(verified.handoff, scenario.handoff);
  assert.equal(verified.candidate.commit_sha, scenario.candidate);
  assert.equal(await driver.head(verified.workspace), scenario.candidate);
  assert.equal(verified.intentText, scenario.intentText);
  assert.equal(verified.evidence.status, "candidate_complete");
  assert.equal(verified.workContract.schema_version, 3);
  assert.deepEqual(
    verified.inputArtifacts.map((ref) => ref.path),
    [
      "products/t/intents/INT-T-0001/intent.md",
      "products/t/policy-profiles/T-DEFAULT.md",
      `${WORK}/spec.md`,
      `${WORK}/work-contract.yaml`,
      `${WORK}/evidence-package/inv-exec-1.json`,
    ],
  );
});

withScenario("the intent backlog is never contacted: preflight passes with it gone", {}, async (scenario) => {
  removeDir(scenario.intents.bare);
  const admitted = admitEvaluation(scenario.invocation, scenario.manifest);
  const verified = await prepareWorkspace(admitted, driverFor(scenario), join(scenario.root, "run"));
  assert.equal(verified.profileText, scenario.profileText);
});

withScenario("a branch that moved past the handoff is blocked", {}, async (scenario) => {
  scenario.product.commit({ "src/other.txt": "x" }, "concurrent writer", BRANCH);
  assert.match(await blockedReasons(scenario), /another writer may have pushed/);
});

withScenario("an Evidence Package edited after it was recorded is blocked", {}, async (scenario) => {
  const edited = scenario.product.commit(
    { [`${WORK}/evidence-package/inv-exec-1.json`]: "{}\n" },
    "rewrite evidence",
    BRANCH,
  );
  scenario.invocation.target.commit_sha = edited;
  assert.match(
    await blockedReasons(scenario),
    /evidence-package\/inv-exec-1.json has changed since its recorded commit/,
  );
});

withScenario("a frozen intent copy whose bytes changed (line endings) is blocked", {}, async (scenario) => {
  const converted = scenario.product.commit(
    { [`${WORK}/intent.md`]: scenario.intentText.replace(/\r\n/g, "\n") },
    "line endings converted",
    BRANCH,
  );
  scenario.invocation.target.commit_sha = converted;
  assert.match(await blockedReasons(scenario), /frozen intent copy .* does not match its recorded SHA-256/);
});

withScenario(
  "an Evidence Package that is not candidate_complete is blocked",
  { evidence: { status: "needs_decision", validation: [] } },
  async (scenario) => {
    assert.match(await blockedReasons(scenario), /Only a candidate_complete Evidence Package can be evaluated/);
  },
);

withScenario(
  "an Evidence Package that does not name the accepted Work Contract is blocked",
  {
    evidence: {
      input_artifacts: [
        {
          repository: "https://github.com/x/y.git",
          commit_sha: "a".repeat(40),
          path: "other.md",
          sha256: "b".repeat(64),
        },
      ],
    },
  },
  async (scenario) => {
    const reasons = await blockedReasons(scenario);
    assert.match(reasons, /does not name the accepted .*work-contract.yaml/);
    assert.match(reasons, /does not name the accepted .*spec.md/);
  },
);

withScenario(
  "a candidate in another repository is blocked",
  { evidence: { candidate: { repository: "https://github.com/other/repo.git", commit_sha: "e".repeat(40) } } },
  async (scenario) => {
    assert.match(await blockedReasons(scenario), /candidate is in a different repository/);
  },
);

withScenario(
  "a candidate that is not in the branch history is blocked",
  { candidateSha: "e".repeat(40) },
  async (scenario) => {
    assert.match(await blockedReasons(scenario), /candidate e+ is not in the work branch history/);
  },
);

withScenario("a required check whose command is not trusted is blocked", {}, async (scenario) => {
  scenario.manifest.repositories[0].checks = { build: "npm run build" };
  assert.match(await blockedReasons(scenario), /trusted command is "npm run build"/);
});

withScenario("a Work Contract that disagrees with the freeze is blocked", {}, async (scenario) => {
  scenario.invocation.freeze_activation.policy_profile_version = "2";
  assert.match(await blockedReasons(scenario), /policy profile does not match the active freeze/);
});
