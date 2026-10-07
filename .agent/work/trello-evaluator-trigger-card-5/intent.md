# Intent: Verify Trello-to-evaluator trigger

## Identity

- **Work ID:** 5
- **Status:** Accepted
- **Intent Version:** 1
- **Product:** Agentic SDLC integration test
- **Trello Card:** https://trello.com/c/lmXd2bwY/5-test-only-verify-remote-evaluator-trigger

## Problem

The Trello-to-evaluator handoff has not been proven with a revision-pinned repository payload. Without that evidence, an operator cannot know whether moving a work item into Agent Review invokes the remote evaluator.

## Desired outcome

Moving the dedicated test User Story into Agent Review sends one authenticated request to the NAS evaluator. The evaluator must check out this exact Git revision, validate the handoff artifacts, complete an independent read-only evaluation, and post a human-readable result to the Trello card.

## Acceptance criteria

- The test card’s Agent Review transition invokes the NAS evaluator exactly once.
- The evaluator accepts the committed intent, Work Contract, and candidate-complete evidence from this revision.
- The evaluator removes its request-scoped checkout after the run.
- Trello records an understandable evaluation result and next action.

## Constraints

- This fixture must not modify MenuFlow or the coding-agent repository.
- The evaluator must remain stateless and read-only.
- This test uses a disposable Trello card and a dedicated Git branch.

## Open decisions


## Handoff

- **Review URL:** https://trello.com/c/lmXd2bwY/5-test-only-verify-remote-evaluator-trigger
- **Accepted by:** Sobe
- **Accepted at:** 2026-09-06T00:00:00Z
