# Evaluator deployment journal

## 2026-09-04

The NAS host can reach OpenAI, but the evaluator container times out while querying the NAS DNS server. The evaluator Compose configuration now uses service-scoped public DNS resolvers so the deployment can be verified without changing DNS behavior for other containers.

The redeployed container remains healthy, but its Docker resolver still returns `EAI_AGAIN` for `api.openai.com`, even with the public DNS configuration. The next change must be to the NAS Docker bridge egress or firewall policy rather than the evaluator service configuration.

The NAS firewall required an explicit return for the evaluator Docker subnet before DNS could leave the bridge. A later direct Codex run reached OpenAI but exposed a separate image defect: the runtime image lacked the operating system CA certificate bundle required by Codex's native TLS client.

The current deployment test reached the authenticated OpenAI endpoint after the firewall, TLS, and entropy fixes. Its remaining failure identified two evaluator defects: Codex requires an explicit API-key login session rather than only the `OPENAI_API_KEY` environment variable, and the canary response schema omitted the required string type. Compose now creates the temporary login session at container startup, and the schema has a regression test.
