# Evaluator Agent

Independent Codex-based evaluator for an agentic software delivery workflow.

The Evaluator reviews a candidate implementation produced by a separate Coding Agent and determines whether it satisfies the original approved Work Contract. It does not write production code, change requirements, move workflow cards, merge branches, or approve its own findings.

## Role in the workflow

```text
Work Contract -> Coding Agent -> deterministic validation -> Evaluator Agent (Codex)
                                                        |
                                                        +-- PASS -> Human Approval
                                                        +-- FAIL -> Coding Agent
                                                        +-- NEEDS_DECISION -> Human
```

## Trust boundaries

- The approved Work Contract is authoritative and immutable for an evaluation run.
- The Coding Agent evidence package is evidence, not proof.
- The candidate repository/worktree is inspected independently in a read-only Codex sandbox.
- The Evaluator has no Trello integration and no Claude dependency.
- The Orchestrator owns workflow state and supplies the contract, evidence, and candidate worktree.
- A contract hash supplied by the Coding Agent must match the exact contract file being evaluated.
- Only `candidate_complete` Coding Agent runs are eligible for evaluation.

## Evaluation behavior

The Evaluator attempts to falsify every acceptance criterion. It inspects the actual candidate, relevant surrounding code, tests, git changes, deterministic validation evidence, architecture, regressions, security concerns, and unintended scope.

It returns one of three outcomes:

- `pass` — every acceptance criterion is verified and no material blocking finding remains.
- `fail` — an implementation defect can be corrected without unresolved product judgment.
- `needs_decision` — proceeding requires human product, architectural, security, or scope judgment not resolved by the contract.

A `pass` is invalid unless every acceptance criterion has status `pass`.

## Inputs

```text
--contract <file>   Approved Work Contract YAML or JSON
--evidence <file>   Coding Agent Evidence Package JSON
--repo <path>       Candidate repository/worktree
```

## Output contract

stdout contains one JSON Evaluation Result. Its machine-readable shape is documented in `schemas/evaluation-result.schema.json` and is also validated in code before it is returned.

Recommendations are fixed to outcomes:

```text
pass             -> human_approval
fail             -> return_to_coding_agent
needs_decision   -> human_decision
```

Exit codes:

```text
0   pass
10  fail
20  needs_decision
1   evaluator/system/input error
2   CLI usage error
```

## Installation and verification

Requires Node.js 20+ and the OpenAI Codex CLI installed and authenticated.

```bash
npm install
npm run check
```

`npm run check` compiles the TypeScript and runs the deterministic unit tests. A successful check verifies the local code but does not substitute for an end-to-end Codex evaluation test.

## Deployment verification and logs

The Synology installer performs two checks before reporting deployment success:

1. It requires `GET /health` to return HTTP `200` and `{"status":"ok"}`.
2. It calls the authenticated `POST /deployment-tests/codex-auth` endpoint. This makes one real, low-scope Codex request using `OPENAI_API_KEY`; it verifies Codex authentication, outbound connectivity, and a structured response.

The terminal report names the test, explains its method, and reports `RUN`, `PASS`, or `FAIL`. A browser-readable, in-memory status view is available at `http://<nas-lan-ip>:8080/`. The view resets when the stateless container restarts.

Container logs are structured JSON lines. Each includes a timestamp, severity, event name, and correlation ID where applicable. The service redacts recognizable OpenAI keys and bearer credentials from logged errors.

## Usage

```bash
node dist/cli.js review \
  --contract /path/to/work-contract.json \
  --evidence /path/to/evidence.json \
  --repo /path/to/candidate-worktree
```

The Evaluator invokes `codex exec` from the candidate repository using a read-only sandbox. The Orchestrator consumes the JSON result and owns all workflow transitions and persistence of the evaluation artifact.

## Production boundary

The Evaluator is intentionally a stateless worker. It should not become the system of record for Work Contracts, evidence, evaluations, or workflow state. In a larger deployment, those artifacts belong in durable workflow/artifact storage managed outside the agent.
