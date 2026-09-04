# Evaluator deployment journal

## 2026-09-04

The NAS host can reach OpenAI, but the evaluator container times out while querying the NAS DNS server. The evaluator Compose configuration now uses service-scoped public DNS resolvers so the deployment can be verified without changing DNS behavior for other containers.
