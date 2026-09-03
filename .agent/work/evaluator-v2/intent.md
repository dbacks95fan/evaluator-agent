# Intent: Intent-aware remote evaluator

## Identity

- **Work ID:** evaluator-v2
- **Status:** Accepted
- **Source:** User-authorized Agentic SDLC design conversation
- **Visualization board:** Trello synchronization pending
- **Root work item:** User Story — pending board ID and URL

## Problem

The evaluator can verify code against a temporary, card-derived Work Contract, but it cannot verify that work traces to an accepted repository intent, provide a decision-ready board summary, or run from the private Synology NAS.

## Desired outcome

An independent evaluator can review an implementation against an accepted, revision-pinned intent and Work Contract, return an evidence-based decision brief for a human, and run as an authenticated service on the local-network NAS.

## Evidence of success

- The evaluator rejects an unaccepted, mismatched, or hash-inconsistent intent handoff.
- Each evaluation includes intent, contract, evidence, and board traceability.
- A `needs_decision` result contains a plain-language decision brief.
- The container exposes a healthy, authenticated LAN service and maintains read-only inputs.
- Each deployment performs a real, low-scope Codex authentication canary and fails if the canary does not complete successfully.
- A human can follow the deployment verification in a plain-language terminal report and a browser-readable status view that show the test, method, current state, and pass or fail result.
- Container logs identify meaningful lifecycle, evaluation, and deployment-test events without logging tokens, API keys, or request secrets.

## Constraints

- The evaluator must not change Trello cards; the conductor owns board updates.
- The service runs on the private local network, using the existing scoped Synology Docker deployment account.
- The evaluator must distinguish known facts from inferences and must not invent missing information.
- The deployment verification must not persist test state inside the container. Any report retained outside the process is deployment evidence, not evaluator workflow state.

## Revision history

### 2026-09-03 — Deployment verification and observability

**Source:** Explicit user direction in this conversation.

**Change:** Add a real Codex-authentication canary, descriptive container logging, and a human-readable deployment verification interface to the evaluator deployment process.

**Acceptance signals:**

- The canary makes one real Codex request using the evaluator's configured OpenAI credentials and reports a descriptive pass or failure result.
- Deployment verification explicitly checks for HTTP `200` from the health endpoint before reporting success.
- The report names each test, explains how it runs, and shows a clear running, pass, or failure state.
- Logs expose event names, timing, correlation IDs, and sanitized errors, but never credentials or bearer tokens.

## Priority profile

- **Importance:** Needs Review
- **Priority band:** Needs Review
- **Outcome value:** TBD — No quantified business evidence was provided.
- **Time criticality:** TBD — No deadline was provided.
- **Risk reduction / opportunity enablement:** TBD — The user identified this as core SDLC infrastructure, but no rating evidence was provided.
- **Review attention:** Review Soon — The service boundary and NAS credentials need human verification before production use.
- **Evidence confidence:** Medium — Architecture and NAS deployment access are known; production resource limits and artifact storage are not yet verified.
- **Relative job size:** 5
- **Sequencing score:** TBD
- **Ready state:** Ready

## Handoff

- **Next stage:** Work Contract and implementation
- **Canonical path:** `.agent/work/evaluator-v2/intent.md`
- **Review URL:** Pending publication to the evaluator repository
- **Accepted by:** User authorization in this conversation
- **Accepted at:** 2026-09-02
