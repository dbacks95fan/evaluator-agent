# Evaluator Agent

Independent Codex-based evaluator for an agentic software delivery workflow.

The Evaluator reviews a candidate implementation produced by a separate Coding Agent and determines whether it satisfies the original approved Work Contract. It does not write production code, change requirements, move Trello cards, merge branches, or approve its own findings.

## Role in the workflow

```text
Work Contract -> Claude Coding Agent -> deterministic validation -> Evaluator Agent (Codex)
                                                               |
                                                               +-- PASS -> Human Approval
                                                               +-- FAIL -> Coding Agent
                                                               +-- NEEDS_DECISION -> Human
```

## Evaluation principles

- Treat the approved Work Contract as the source of truth.
- Inspect the candidate repository state, not just the Coding Agent's summary.
- Treat the Coding Agent evidence package as evidence, not proof.
- Attempt to falsify each acceptance criterion.
- Look for regressions, unintended scope, weak tests, architectural violations, and unsupported claims.
- Report only findings supported by observable evidence.
- Never modify the candidate repository.

## Inputs

- `--contract` - approved Work Contract YAML or JSON.
- `--evidence` - Coding Agent evidence package JSON.
- `--repo` - candidate worktree/repository to review.

## Output

The CLI returns one JSON object with one of three statuses:

- `pass` - candidate can proceed to Human Approval.
- `fail` - implementation issue should return to the Coding Agent.
- `needs_decision` - human judgment is required before work can continue.

## Usage

Requires Node.js 20+ and the OpenAI Codex CLI installed and authenticated.

```bash
npm install
npm run build
node dist/cli.js review --contract /path/to/work-contract.yaml --evidence /path/to/evidence.json --repo /path/to/candidate-worktree
```

The Evaluator invokes Codex in a read-only sandbox from the candidate repository. The orchestrator consumes the JSON result and owns all workflow transitions.

## Boundaries

The Evaluator intentionally has no Trello integration, no Claude dependency, and no authority to merge, deploy, modify the candidate, or rewrite the Work Contract. Its only responsibility is independent evaluation.
