# Conductor Integration

What the Conductor must send to the Evaluator and verify afterward. The lifecycle rules come from agentic-sdlc Stage Contracts §5 and the shared rules; this page is the concrete wire contract for this component.

## Invoke

`POST /invocations` with `Authorization: Bearer <EVALUATOR_API_TOKEN>` and a `StageInvocation` 1.1 body:

| Field | Required value |
| --- | --- |
| `schema_version` | `"1.1"` (1.0 is rejected) |
| `stage` | `"evaluation"` |
| `work_item` | Equal to `freeze_activation.work_item` |
| `freeze_activation` | The active `FreezeActivationEvent`, unchanged |
| `input_artifacts` | Exactly three references: the accepted `.agent/work/<intent-id>/spec.md` and `.agent/work/<intent-id>/work-contract.yaml` from the Spec Acceptance Record, and the Coding Agent's `.agent/work/<intent-id>/evidence-package/<name>.json` from its StageResult `output_artifacts`. |
| `target` | The product repository and the **handoff commit**: the Evidence Package commit, which is the work branch tip. The candidate is identified by the Evidence Package itself. |
| `workspace_ref` | `work/<intent-id>` |
| `read_paths` | Usually `["."]` |
| `write_paths` | `.agent/work/<intent-id>/evaluation-package` (or a parent of it) |

Then poll `GET /invocations/{invocation_id}` until `state` is `done`. The service runs one invocation at a time and returns `409 busy` for a second. Resubmitting an identical body is safe.

## Verify the result

Before routing, the Conductor (read-only) should:

1. Validate `stage_result` against `#/$defs/StageResult` and confirm `invocation_id`, `stage`, and `work_item` match.
2. For `pass`, `fail`, and `needs_decision`: confirm the work branch tip equals `output_artifacts[0].commit_sha`, its parent is the handoff, the package file's SHA-256 matches, and `candidate` equals the Evidence Package candidate.
3. Validate the Evaluation Package against `#/$defs/EvaluationPackage` and compare its `checks` names and outcomes to the accepted Work Contract's `required_validation`.
4. Revalidate that the freeze is still active, then record a `StageResultDecision`.

## Routing

- `pass` → Human Approval.
- `fail` with only `implementation` or `evidence` blocking findings → Execution, with this Evaluation Package as the rework input (the Coding Agent accepts `evaluation-package/<name>.json`).
- `fail` with any blocking `specification` finding → hold for the accountable human; a non-material correction may return to Spec & Design with their authorization.
- `fail` with a blocking `policy` finding, `needs_decision`, `blocked`, and `failed` → hold in Evaluation for the accountable human.
