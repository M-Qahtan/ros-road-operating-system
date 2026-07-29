# Safety and traffic SLOs

## Governing principle

Life-safety objectives take precedence over traffic-efficiency objectives. Safety invariants are not tradable against availability, throughput, convenience, or delivery speed.

## Non-negotiable safety invariants

- S3/S4 RoadEvents cannot close without explicit, authenticated human authority and a complete audit record.
- Automated logic cannot diagnose a medical condition, determine legal fault, issue real government dispatch, downgrade S3/S4 severity, or close/reopen a road.
- Ambiguous, conflicting, stale, missing, or disconnected evidence routes to human review or escalation.
- A durable safety-state write is never acknowledged when PostgreSQL/PostGIS persistence cannot be proven.
- Restore/readiness failure blocks release.
- Evidence integrity, authorization, and auditability failures fail closed.

These invariants have no error budget. Any confirmed violation is a P0 or P1 release blocker according to impact.

## Life-safety SLIs and MVP engineering targets

| SLI | MVP target | Measurement boundary | Failure response |
|---|---:|---|---|
| Time from incident correlation to human-safety contact initiation | p95 ≤ 10 seconds in deterministic pilot conditions | From durable RoadEvent creation to first contact-attempt audit event | Escalate to human review; investigate latency |
| Unanswered high-risk contact escalation | 100% by configured deadline | From contact-attempt start to escalation audit event | P0/P1 depending on severity and exposure |
| Durable event-write acknowledgement | 100% only after persistence confirmation | API/worker acknowledgement path | Reject command and remain fail-closed |
| S3/S4 unauthorized downgrade, resolution, closure, or reopening rejection | 100% | Contract/state-machine and failure-mode suites | Immediate release block |
| Evidence checksum and event-scope enforcement | 100% | Evidence ingestion and access tests | Quarantine/deny; preserve audit metadata |
| Required audit record completeness | 100% for safety transitions | Transition ID, actor, authority, reason, evidence revision, policy version, timestamps | Transition rejected or case escalated |

These are MVP engineering targets for controlled validation, not public emergency-response commitments.

## Traffic-efficiency objectives

| Objective | Initial engineering target | Safety constraint |
|---|---:|---|
| Event-list/read latency | p95 ≤ 500 ms under pilot load | May degrade before any safety invariant is relaxed |
| Route-impact update freshness | p95 ≤ 30 seconds | Stale data is labeled and cannot drive high-risk automation |
| Dashboard availability | ≥ 99.5% engineering target | Human-safety escalation channels retain priority |
| Duplicate operational notifications | ≤ 0.1% after idempotency | Never suppress a required safety escalation |

Error budgets apply only to traffic-efficiency objectives. They may never be consumed to waive life-safety, security, privacy, evidence, restore, or human-authority controls.

## Release interpretation

A candidate is not release-ready merely because aggregate availability is acceptable. Every non-negotiable invariant, required CI/Security gate, PostgreSQL restore, staging fault-injection check, Riyadh E2E scenario, failure-mode suite, and operational-readiness decision must succeed on the same candidate identity.
