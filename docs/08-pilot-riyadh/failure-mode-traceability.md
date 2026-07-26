# Riyadh MVP failure-mode safety traceability

This suite remains inside the approved Riyadh MVP boundary. It does not grant machine learning authority to diagnose, determine legal fault, dispatch real agencies, downgrade severity, or reopen a road.

| Hazard | Failure mode | Safety control | Automated evidence | Required safe state |
|---|---|---|---|---|
| HZ-01 | Conflicting or low-confidence signals | Confidence threshold and conflict quarantine | `riyadh-failure-modes.spec.ts` | Event remains validating until trusted corroboration |
| HZ-02 | Late-arriving signal | Append-only late-signal ingestion | `riyadh-failure-modes.spec.ts` | History remains intact; closed state is never silently rewritten |
| HZ-03 | Concurrent stale update | Optimistic version check | `riyadh-failure-modes.spec.ts` | Stale update rejected deterministically |
| HZ-04 | Out-of-order delivery | Monotonic sequence application | `riyadh-failure-modes.spec.ts` | Deterministic ordered state |
| HZ-05 | Duplicate notification and retry storm | Idempotency key plus bounded retry | `riyadh-failure-modes.spec.ts` | One operational intent is delivered |
| HZ-06 | PostgreSQL unavailable | Fail-closed command admission | `riyadh-failure-modes.spec.ts` | No durable safety write is falsely acknowledged |
| HZ-07 | Redis/object storage/network partition | Safe degradation mode | `riyadh-failure-modes.spec.ts` | Human-safety queue retained; traffic automation suspended |
| HZ-08 | Evidence checksum mismatch | SHA-256 verification | `riyadh-failure-modes.spec.ts` | Tampered evidence rejected |
| HZ-09 | Malware or scanner quarantine | Quarantine gate | `riyadh-failure-modes.spec.ts` | Evidence metadata retained while content remains unavailable |
| HZ-10 | Cross-event evidence access | Event-scoped authorization | `riyadh-failure-modes.spec.ts` | Access denied |
| HZ-11 | Unanswered human-safety conversation | Response deadline and automatic escalation | `riyadh-failure-modes.spec.ts` | High-risk escalation occurs within the modeled deadline |
| HZ-12 | Unauthorized severity downgrade or road reopening | Supervisor authorization invariant | `riyadh-failure-modes.spec.ts` | Downgrade/reopening rejected |

## Evidence contract

`pnpm simulate:riyadh:failures` builds the workspace and emits `artifacts/riyadh-failure-modes/result.json`. Every hazard result contains the executing `GITHUB_SHA`; CI uploads the JSON and this traceability table in an artifact named with the same commit SHA.

A failed hazard assertion fails the command and therefore blocks the dedicated safety workflow. This suite complements, but does not replace, PostgreSQL/PostGIS integration, staging smoke, recovery drills, or the original Riyadh vertical-slice proof.
