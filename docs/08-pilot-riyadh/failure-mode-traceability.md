# Riyadh MVP failure-mode safety traceability

This suite remains inside the approved Riyadh MVP boundary. It does not grant machine learning or automation authority to diagnose, determine legal fault, dispatch real agencies, downgrade S3/S4 severity, resolve a human-safety case, or close/reopen a road.

| Hazard | Failure mode | Safety control | Automated evidence | Required safe state |
|---|---|---|---|---|
| HZ-01 | Conflicting or low-confidence signals | Confidence threshold and conflict quarantine | `riyadh-failure-modes.spec.ts` | Event remains validating until trusted corroboration |
| HZ-02 | Late evidence after closure | Append-only evidence revision without state rewrite | `riyadh-failure-modes.spec.ts` | Evidence retained; closed event is not silently reopened or rewritten |
| HZ-03 | Concurrent stale update | Optimistic version check | `riyadh-failure-modes.spec.ts` | Stale update rejected deterministically |
| HZ-04 | Out-of-order delivery | Monotonic sequence application | `riyadh-failure-modes.spec.ts` | Deterministic ordered state |
| HZ-05 | Duplicate notification and retry storm | Idempotency key plus bounded retry | `riyadh-failure-modes.spec.ts` | One operational intent is delivered |
| HZ-06 | PostgreSQL unavailable | Fail-closed command admission | `riyadh-failure-modes.spec.ts` | No durable safety write is falsely acknowledged |
| HZ-07 | Redis/object storage/network disruption | Safe degradation mode | `riyadh-failure-modes.spec.ts` | Human-safety queue retained; traffic automation suspended |
| HZ-08 | Evidence checksum mismatch | SHA-256 verification | `riyadh-failure-modes.spec.ts` | Tampered evidence rejected |
| HZ-09 | Malware or scanner quarantine | Quarantine gate | `riyadh-failure-modes.spec.ts` | Metadata retained while content remains unavailable |
| HZ-10 | Cross-event evidence access | Event-scoped authorization | `riyadh-failure-modes.spec.ts` | Access denied |
| HZ-11 | Unanswered human-safety contact | Response deadline and escalation to human review | `riyadh-failure-modes.spec.ts` | Human review escalated without autonomous external dispatch |
| HZ-12 | Unauthorized S3/S4 downgrade, resolution, closure, or reopening | Supervisor authority invariant | `riyadh-failure-modes.spec.ts` | Action rejected |

## Evidence contract

`pnpm simulate:riyadh:failures` builds the workspace and emits `artifacts/riyadh-failure-modes/result.json`. The result records `candidateHeadSha`, `candidateBaseSha`, and `testedMergeSha`; every hazard record is bound to the tested merge SHA.

The dedicated `Riyadh Failure-Mode Safety / riyadh-failure-modes` job validates the complete twelve-hazard set, rejects duplicate or missing hazards, rejects failed safe-state assertions, validates the shared CI evidence manifest, and uploads a commit-addressed evidence artifact. Missing or empty evidence fails the job.

This suite complements, but does not replace, repository verification, lint, typecheck, build, unit tests, PostgreSQL/PostGIS migration and restore checks, staging smoke/fault injection, Security, SBOM, secret scanning, dependency gates, and Riyadh vertical-slice evidence.
