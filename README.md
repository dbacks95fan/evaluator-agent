# evaluator-agent

The independent Evaluator for the [Agentic SDLC](https://github.com/dbacks95fan/agentic-sdlc) Evaluation stage. It receives a `StageInvocation` 1.1 from the Conductor, fetches the work branch at the exact handoff commit, verifies every frozen, accepted, and evidence input, checks out the exact candidate commit, reruns the Work Contract's required checks itself, and reviews the candidate with an OpenAI model through the Responses API. It then pushes a canonical Evaluation Package to the work branch and returns a correlated `StageResult`.

It never changes candidate code, approves, merges, releases, moves Trello cards, or changes the intent, policy profile, spec, or Work Contract. `pass` means "ready for Human Approval", not "approved".

The normative contract is `agentic-sdlc` (Stage Contracts §5 Evaluation, Artifacts, Workflow, Governance, and `schemas/lifecycle-contracts.schema.json`). This repository vendors that schema byte-for-byte; `npm run check:schema-sync` confirms it matches a sibling checkout.

## How a run works

1. **Admit** the invocation: schema 1.1, stage `evaluation`, matching work identity, `workspace_ref` equal to `work/<intent-id>`, trusted repositories, exactly one accepted `spec.md`, one accepted `work-contract.yaml`, and one `evidence-package/<name>.json`, and `write_paths` that cover this run's Evaluation Package path. Anything wrong returns `blocked` before any network or model call.
2. **Fetch and verify**: the remote branch tip must equal `target.commit_sha` (the handoff, which is the Evidence Package commit). The spec, Work Contract, and Evidence Package must hash correctly at their recorded commits and be unchanged at the handoff. The frozen intent and policy-profile copies on the branch must match the freeze fingerprints; the Evaluator never contacts `intent-backlog`. The Work Contract must agree with the freeze. The Evidence Package must be `candidate_complete`, name the accepted spec and contract, and identify a candidate in the branch history built on the contract's base. Every required check must appear, with the identical command, in the trusted manifest.
3. **Check out the candidate**, detached, at the exact SHA the Evidence Package names.
4. **Set up** with the manifest's setup commands, then **rerun every required check** exactly as the manifest defines it. These observed results, not the Coding Agent's claims, go into the package.
5. **Review** with the OpenAI Responses API (`store: false`). The model can list, read, and search the candidate and see `git diff` against the accepted base, all read-only and confined to the checkout. It returns a schema-checked verdict with one entry per acceptance criterion and classified findings.
6. **Decide** deterministically. The model can lower the status but never raise it:
   - a failed rerun check or an unsatisfied criterion is a blocking `implementation` finding;
   - a model finding keeps its category (`implementation`, `specification`, `policy`, `evidence`), so the Conductor can tell an implementation fix from a spec defect;
   - a needed decision, or a criterion the model could not verify, is `needs_decision`;
   - `pass` needs every check passed, every criterion satisfied, and nothing blocking.
7. **Publish** (for `pass`, `fail`, `needs_decision`): commit the Evaluation Package at `.agent/work/<intent-id>/evaluation-package/<invocation-id>.json` on top of the handoff and push fast-forward only. The candidate commit is untouched. If the branch moved, nothing is pushed and the result is `blocked`.

`blocked` and `failed` push nothing and explain why in `StageResult.findings`.

## Commands

```
npm ci
npm run check            # typecheck, tests, build
npm run test:deploy      # Pester tests for the NAS deployment scripts
npm run check:schema-sync

node dist/cli.js serve
node dist/cli.js self-test
```

## HTTP API (`serve`)

The same boundary as the Coding Agent, so the Conductor uses one client for both.

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | `200 {"status":"ok","busy":bool}` |
| `POST /invocations` | Bearer | Body is a StageInvocation. `202` starts it; resubmitting the same body is idempotent; different content for the same ID or a second concurrent run returns `409`. |
| `GET /invocations/{id}` | Bearer | `{"state":"running"}` or `{"state":"done","stage_result":…,"evaluation_package":…,"diagnostics":…}` |
| `POST /self-test` | Bearer | Toolchain, GitHub App read and write tokens for every target repository, Git access, proof that the driver refuses every intent repository, and one tiny model request. `200` all pass, `503` otherwise. |

See [docs/INTEGRATION.md](docs/INTEGRATION.md) for what the Conductor must send and verify.

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | OpenAI API key; the Responses API is called directly, no Codex CLI |
| `EVALUATOR_MODEL` | `gpt-6.1-sol` | The model OpenAI's Codex docs configured as of 2026-10-31 |
| `EVALUATOR_REASONING_EFFORT` | API default | Optional reasoning effort |
| `EVALUATOR_GITHUB_APP_ID` / `_INSTALLATION_ID` / `_PRIVATE_KEY_FILE` | none | GitHub App for product repositories. All three or none; none only suits local remotes. |
| `EVALUATOR_API_TOKEN` | required for `serve` | Bearer token the Conductor sends |
| `EVALUATOR_MANIFEST` | `/config/manifest.json` | Trusted repositories, setup, and check commands. The deployment copies the Coding Agent's committed `config/manifest.json`, the single source of trusted checks. |
| `EVALUATOR_MAX_TURNS` / `_MAX_RUNTIME_MIN` | `40` / `30` | Review limits; hitting one without failed checks returns `blocked` |
| `EVALUATOR_CHECK_TIMEOUT_MIN` / `_SETUP_TIMEOUT_MIN` | `15` / `20` | Command limits |
| `EVALUATOR_WORK_ROOT` | OS temp | Per-run scratch space; each run's directory is deleted afterward |
| `EVALUATOR_COMMAND_ENV_<NAME>` | none | Passed to setup and check commands as `<NAME>` |

`EVALUATOR_ALLOWED_REPOSITORY_URLS` and `CODEX_HOME` from the earlier Codex CLI build are refused at startup, so a stale settings file is noticed.

## GitHub access

- **Product repositories: a GitHub App** with Contents read and write, installed on product repositories only. Each Git call gets a one-hour token for its one repository: **write** only to push the Evaluation Package, **read** otherwise. A token GitHub returns with any wider scope is refused.
- **Intent repositories: no access.** The frozen copies on the work branch are verified against the freeze fingerprints. The driver refuses any Git call to an intent repository, and the self-test confirms it.
- Credentials stay in the service process. Setup and check commands get an allowlisted environment without them.

## Deploying on the NAS

Like the Coding Agent: it starts as root with only SETUID and SETGID, loads its secrets, and switches to uid 10001 before any job runs. It has a read-only root, `no-new-privileges`, host networking on port 8080, and data under `/volume2/docker/evaluator-agent-data`.

1. Copy `.env.example` to `C:\Repos\.config\evaluator-agent\runtime.env` and fill it in.
2. `scripts/set-nas-secrets.ps1` checks that file and the key, then writes them to `/volume2/docker/evaluator-agent/` over SSH stdin.
3. `scripts/deploy-synology.ps1` builds the image from a committed revision, packages it with the compose file, the installer, and the Coding Agent's committed check manifest, and runs `scripts/install-on-nas.sh` on the NAS.
4. The installer refuses to change anything if a secret or the key is missing or a retired setting is present, then reports success only when `GET /health` returns `200` and `POST /self-test` passes. The self-test makes one tiny paid model request.

The earlier deployment lived under `/volume1` and has been stopped since about 2026-10-07; this one replaces it on `/volume2`.
