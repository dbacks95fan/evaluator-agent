# Evaluator deployment journal

## 2026-09-04

The NAS host can reach OpenAI, but the evaluator container times out while querying the NAS DNS server. The evaluator Compose configuration now uses service-scoped public DNS resolvers so the deployment can be verified without changing DNS behavior for other containers.

The redeployed container remains healthy, but its Docker resolver still returns `EAI_AGAIN` for `api.openai.com`, even with the public DNS configuration. The next change must be to the NAS Docker bridge egress or firewall policy rather than the evaluator service configuration.

The NAS firewall required an explicit return for the evaluator Docker subnet before DNS could leave the bridge. A later direct Codex run reached OpenAI but exposed a separate image defect: the runtime image lacked the operating system CA certificate bundle required by Codex's native TLS client.

The current deployment test reached the authenticated OpenAI endpoint after the firewall, TLS, and entropy fixes. Its remaining failure identified two evaluator defects: Codex requires an explicit API-key login session rather than only the `OPENAI_API_KEY` environment variable, and the canary response schema omitted the required string type. Compose now creates the temporary login session at container startup, and the schema has a regression test.

The first startup-authentication deployment exposed a Codex CLI requirement that `CODEX_HOME` already exist. Because the evaluator uses an empty tmpfs for ephemeral credentials, the startup command now creates that directory before logging in; the configuration test covers this condition.

Synology's Docker Compose also expands a single dollar sign in command text before the container starts. The evaluator command now escapes `CODEX_HOME` with `$$`, preserving the intended environment-variable expansion inside the container shell.

The final NAS deployment started successfully: its health endpoint returned HTTP 200 and Codex completed API-key login at startup. The live canary reached OpenAI but the API organization rejected it because no billing credits remain. Evaluation work is blocked only until API credits are added; this is not a NAS connectivity or authentication failure.

2026-11-01: rebuilt the Evaluator on the canonical contract, overnight, to the Coding
Agent's pattern. It takes a StageInvocation 1.1 for `evaluation`, verifies the
handoff (spec, contract, evidence, frozen copies; never the intent backlog), checks
out the exact candidate, reruns the trusted checks itself, reviews with the OpenAI
Responses API directly (no Codex CLI), and publishes an EvaluationPackage 1.0.

- **The model can lower the status, never raise it.** A failed rerun check or an
  unsatisfied criterion is a blocking implementation finding whatever the model says.
- **Findings carry a category,** so the Conductor can route an implementation fix to
  Execution and hold a spec defect for a human.
- **One client for both workers.** Same HTTP boundary as the Coding Agent.
