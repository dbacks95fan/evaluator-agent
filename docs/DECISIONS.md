# Decisions

## Decided

- **Canonical contracts only.** The worker accepts StageInvocation 1.1 for `evaluation` and emits StageResult 1.0 and EvaluationPackage 1.0, validated against the vendored agentic-sdlc schema (`urn:agentic-sdlc:lifecycle-contracts:1.3.0`). The earlier custom `/evaluations` request and evaluation-result schema were removed rather than kept alongside, because the SDLC says consumers reject non-canonical records instead of coercing them.
- **Same boundary and driver as the Coding Agent.** The HTTP API, preflight, Git driver, GitHub App credentials, trusted manifest, command sandbox, and privilege drop follow the Coding Agent's proven implementation, so both stage workers behave the same way and the Conductor uses one client.
- **OpenAI Responses API, called directly.** Evaluation runs on Codex models per the operating model. The worker calls the Responses API with `OPENAI_API_KEY` over `fetch` with `store: false`, instead of the unpinned Codex CLI, so no second program or login lives in the image. Default model `gpt-6.1-sol`, the model Codex's documentation configured as of 2026-10-31; every `*-codex` model is shut down or deprecated.
- **Checks are rerun, not trusted.** The Evaluator reruns each required check from the shared manifest at the exact candidate. The Evidence Package's claims are compared and a disagreement is recorded as an `evidence` finding.
- **The model cannot raise the status.** Deterministic rules decide; see README "How a run works", step 6.
- **Handoff commit.** `StageInvocation.target.commit_sha` is the Evidence Package commit (the branch tip); the candidate comes from the Evidence Package, which preflight verifies is in the branch history and built on the Work Contract's base.
- **Package path.** `.agent/work/<intent-id>/evaluation-package/<invocation-id>.json`, so each evaluation keeps its own record and a rework invocation can name the exact package.
- **No intent-backlog access.** Following agentic-sdlc `2314c31`, only the frozen copies on the work branch are verified; intent repositories are named in the manifest for provenance and refused by the credential router.
- **Single source of trusted checks.** The deployment copies the Coding Agent's committed `config/manifest.json` rather than keeping a second copy here.

## Open

- **`blocked` and `failed` publish no package.** Stage Contracts §5 lists those statuses among Evaluation Package outcomes, but a blocked run often cannot trust or reach the branch. Their reasons are in the StageResult instead. Confirm upstream whether a package is required for them.
- **Upstream clarification.** agentic-sdlc does not name, per stage, which StageInvocation field carries the handoff commit; this worker reads `target`, as the Coding Agent does.
- **Linting.** This repository has TypeScript strict checks and tests but no ESLint or Prettier configuration; adding them is a dependency decision.
