# Operational Readiness, Release, Rollback, and Recovery Gates

## Release principle

A ROS release is eligible only when every mandatory safety and recovery gate produces evidence tied to the candidate commit SHA. Missing evidence is failure.

## Required CI evidence

Each release candidate must retain artifacts containing:

- commit SHA and workflow run identifier;
- repository verification, lint, typecheck, build, and tests;
- PostgreSQL/PostGIS migration and invariant results;
- backup and clean-restore verification;
- staging liveness and readiness results;
- deterministic Riyadh end-to-end result;
- safe fault-injection report;
- operational-readiness gate result.

## Operational readiness checklist

### Safety and product boundaries

- [ ] Riyadh MVP scope remains unchanged.
- [ ] Government, medical, legal-fault, and production-dispatch integrations remain explicitly simulated.
- [ ] S3/S4 human authorization invariant is tested.
- [ ] Severity reassessment invalidates prior closure authorization.
- [ ] Failed/unanswered human-safety contact has a tested escalation deadline.

### Reliability

- [ ] All critical SLIs have a measurement source, threshold, owner, and playbook.
- [ ] Traffic-efficiency error budgets are separate from safety invariants.
- [ ] PostgreSQL, Redis, object storage, notification, and network degradation behavior is documented and tested.
- [ ] No dependency failure produces silent success.
- [ ] Retry paths are idempotent and bounded.

### Recovery

- [ ] PostgreSQL backup checksum verifies.
- [ ] Restore runs into a clean database.
- [ ] RoadEvent and audit tables are present after restore.
- [ ] Recovery drill meets RPO/RTO targets.
- [ ] Restore failure blocks release.

### Security and privacy

- [ ] Observability contains no raw PII, medical narrative, precise coordinates, evidence content, object keys, credentials, or access tokens.
- [ ] Evidence access remains event-scoped and unauthorized access is rejected.
- [ ] Quarantine is fail-closed.
- [ ] CI logs and artifacts do not expose reusable credentials.

### Operations

- [ ] Incident severity, ownership, escalation, and communication paths are assigned.
- [ ] Rollback command and decision owner are documented.
- [ ] Dashboard stale-data behavior disables critical actions.
- [ ] On-call handoff and post-incident review template are available.

## RPO and RTO targets for Riyadh MVP

| Capability | RPO | RTO | Verification |
|---|---:|---:|---|
| RoadEvent, audit, outbox | 5 minutes | 30 minutes | clean PostgreSQL restore drill |
| Evidence metadata | 5 minutes | 30 minutes | database restore + count/integrity checks |
| Evidence objects | 15 minutes | 60 minutes | MinIO mirror restore + checksum/object count |
| Operator dashboard | derived from durable state | 15 minutes after core services | readiness and read-model smoke |
| Notification processing | zero accepted intent loss | 15 minutes | durable outbox replay |

These are MVP engineering targets, not public service commitments.

## Release gates

A release is blocked when any of the following occurs:

1. any required CI job is missing, cancelled, or unsuccessful;
2. operational-readiness script fails;
3. backup or restore verification fails;
4. a safety invariant test fails;
5. fault injection reveals silent loss, unsafe closure, unauthorized evidence access, or unbounded retry;
6. required evidence cannot be traced to the candidate commit SHA;
7. privacy scan detects prohibited observability fields.

## Rollback gates

Rollback is mandatory when:

- a P0/P1 regression is detected after deployment;
- readiness changes from healthy to unsafe and cannot be restored within 10 minutes;
- a safety invariant is violated or cannot be proven;
- data integrity, evidence authorization, or durable outbox guarantees are uncertain.

Rollback must preserve migration history, audit records, and backup manifests. Destructive migration rollback is prohibited; use forward correction where schema changes have been applied.

## Release decision record

Record:

- candidate commit SHA;
- CI run and artifact links;
- gate results;
- known limitations;
- approving Release Manager and Safety Lead;
- deployment window;
- rollback trigger and owner.
