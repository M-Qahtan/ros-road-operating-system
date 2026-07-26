# Riyadh MVP — Failure-Mode Safety Traceability

This document is the authoritative traceability matrix for GitHub issue #21. It stays inside the approved Riyadh MVP boundary. Machine learning has no autonomous decision authority in this suite; ambiguous, conflicting, late, or low-confidence inputs always require deterministic controls or human review.

CI publishes this file together with the complete test log, a checksum file, and a manifest containing the exact `GITHUB_SHA`. The artifact name is `riyadh-safety-<commit-sha>`.

| Hazard ID | Failure mode | Safety control / invariant | Deterministic automated proof | Required safe state |
|---|---|---|---|---|
| HAZ-SIG-001 | Conflicting high-confidence incident and no-incident signals | Never auto-progress when eligible signals conflict | `conflicting high-confidence signals fail safe to human review` | `HUMAN_REVIEW_REQUIRED` |
| HAZ-SIG-002 | Low-confidence signals treated as operational authority | Confidence threshold rejects authority and requires review | `low-confidence and late signals cannot silently create authority` | `HUMAN_REVIEW_REQUIRED` |
| HAZ-SIG-003 | Late-arriving signal mutates an active event without revalidation | Late evidence cannot silently advance state | `late corroborating evidence forces revalidation instead of unsafe automatic progression` | `HUMAN_REVIEW_REQUIRED` |
| HAZ-CON-001 | Two writers update the same RoadEvent version | Optimistic concurrency rejects stale writer deterministically | `concurrent stale updates are rejected deterministically` | Conflict; persisted winner remains authoritative |
| HAZ-MSG-001 | Duplicate notifications or retry storm creates duplicate dispatch intent | Delivery key and sequence remain idempotent | `duplicate, retry-storm and out-of-order notifications remain idempotent` | One delivered intent only |
| HAZ-MSG-002 | Out-of-order message overwrites newer operational intent | Older sequence is blocked | Same delivery-guard test | `OUT_OF_ORDER_BLOCKED` |
| HAZ-DEP-001 | PostgreSQL unavailable during critical operation | Fail closed for create/closure where durable state is unavailable | `critical dependency failures degrade safely and block unsafe closure` | `BLOCKED` |
| HAZ-DEP-002 | Redis unavailable during notification workflow | Keep action pending; do not claim delivery | Same dependency-gate test | `RETRY_PENDING` / closure blocked |
| HAZ-DEP-003 | Object storage unavailable during evidence completion | Do not mark evidence preserved | Same dependency-gate test | `BLOCKED` |
| HAZ-DEP-004 | Network partition creates partial operational state | Critical closure requires all safety dependencies healthy | Same dependency-gate test | `BLOCKED` |
| HAZ-EVD-001 | Evidence checksum mismatch | Quarantine and deny download | `evidence checksum mismatch, scanner failure, missing evidence and cross-event access fail closed` | `QUARANTINED` |
| HAZ-EVD-002 | Malware scanner error or malicious verdict | Scanner failure fails closed | Same evidence test | `QUARANTINED` |
| HAZ-EVD-003 | Evidence missing | Return explicit failure; never infer availability | Same evidence test | `BLOCKED` |
| HAZ-EVD-004 | Cross-event evidence access | Bind evidence to one RoadEvent and reject mismatch | Same evidence test | Access denied |
| HAZ-HUM-001 | Human-safety conversation unanswered | Escalate exactly at deterministic deadline | `unanswered human-safety conversation escalates exactly at its deadline` | `ESCALATED` |
| HAZ-SEV-001 | Severity downgraded without accountable human approval | Any decrease requires explicit human approval | `severity cannot be downgraded without explicit human approval` | Downgrade rejected |
| HAZ-CLS-001 | Road reopened while human safety unresolved | Human safety must be resolved before closure | `road reopening requires human safety resolution, supervisor authorization and preserved evidence` | Closure blocked |
| HAZ-CLS-002 | S3/S4 closure without supervisor authorization | Human authorization is mandatory | Same closure-gate test plus existing RoadEvent domain tests | Closure blocked |
| HAZ-CLS-003 | Road reopened while dependencies unhealthy | Critical dependencies must be healthy | Same closure-gate test | Closure blocked |
| HAZ-CLS-004 | Road reopened before evidence preservation | Evidence preservation is a closure prerequisite | Same closure-gate test | Closure blocked |

## Evidence contract

A review or release candidate is not considered proven unless the `Riyadh Safety Failure Modes` workflow succeeds and its downloadable artifact contains:

1. `riyadh-failure-mode-tests.log` — complete Node test output.
2. `manifest.json` — repository, ref, workflow run, and exact commit SHA.
3. `checksums.sha256` — integrity hashes for the log and this matrix.
4. This traceability matrix.

A failed, cancelled, skipped, or missing workflow run is a release blocker for the Riyadh MVP safety slice.

## Explicit boundaries

- Agencies remain simulated; the suite does not claim real ambulance, traffic, towing, insurance, or government dispatch.
- No medical diagnosis or legal fault attribution is performed.
- ML may provide evidence or confidence scores only; it cannot close an event, downgrade severity, reopen a road, or suppress human-safety escalation.
- These controls prove deterministic software behavior. Operational validation, field exercises, regulatory approval, and independent safety assessment remain required before real-world deployment.
