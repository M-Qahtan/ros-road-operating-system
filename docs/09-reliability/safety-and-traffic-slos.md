# ROS Safety and Traffic Reliability Objectives

## Purpose

This specification defines measurable reliability objectives for the Riyadh MVP without changing product scope. Life-safety invariants are release gates, not tradable availability targets.

## Classification

- **Safety-critical SLI/SLO:** protects human life, prevents unsafe state transitions, or preserves evidence required for response and review.
- **Traffic-efficiency SLI/SLO:** improves road recovery and operator efficiency but may degrade safely.
- **Safety invariant:** must hold for every request. Error budgets never authorize violation.

## Safety invariants

1. S3/S4 RoadEvents cannot close without explicit authorized human approval.
2. Severity reassessment invalidates stale closure authorization.
3. A high-risk event cannot be silently dropped, overwritten, or downgraded without an auditable authorized decision.
4. RoadEvent, audit log, and outbox intent are committed atomically.
5. Cross-event evidence access is denied.
6. Evidence integrity failure results in quarantine, not availability.
7. Missing or failed human-safety contact escalates within the configured deadline.
8. Restore/readiness failure blocks release.

## SLIs and SLOs

| Domain | Class | SLI | Measurement source | MVP objective | Alert / action |
|---|---|---|---|---|---|
| Signal ingestion | Safety | accepted valid signals recorded without loss | API counters + database reconciliation | 99.99% over 30 days; zero silent loss | P1 at any silent loss |
| RoadEvent creation | Safety | valid incident correlations create or reuse exactly one RoadEvent | idempotency audit + DB invariants | 99.99%; duplicate event rate <0.01% | P1 for duplicate/lost event |
| Human-safety escalation | Safety | S3/S4 events reach safety workflow before deadline | audit timestamps | 99.9% within 30 s; zero untracked misses | P0 for missed escalation |
| Safety conversation | Safety | unanswered/failed contact escalates | conversation timer audit | 100% escalated within 60 s | P0 if not escalated |
| Closure authorization | Safety invariant | unauthorized S3/S4 closure attempts rejected | authorization/audit tests | 100% rejection | release blocker |
| Notification delivery | Safety | simulated critical agency intent reaches durable outbox and final state | outbox metrics + reconciliation | 99.9% within 60 s; no untracked loss | P1; safe retry/dead-letter |
| Evidence integrity | Safety | completed evidence checksum verified and access authorized | evidence audit | 100% verified or quarantined | release blocker on bypass |
| Evidence availability | Safety | authorized evidence metadata remains queryable | DB/API probe | 99.95% | P1; object unavailable is explicit |
| Dashboard freshness | Safety | operator view age for active S3/S4 | read-model timestamp | 99.9% <15 s | block critical action when stale |
| Recovery | Safety | verified restore preserves RoadEvent/audit/evidence metadata | restore drill artifact | 100% of release drills pass | release blocker |
| Traffic clearance | Efficiency | confirmed incidents reach RoadClearance state | audit timestamps | 95% within pilot target agreed per incident type | P2 review |
| Road restoration | Efficiency | RoadClearance to Recovery | audit timestamps | 95% within pilot target | P2 review |
| Dashboard latency | Efficiency | p95 list/detail response | API telemetry | p95 <500 ms in pilot load | P2 degradation |

## Error budgets

Error budgets apply only to traffic-efficiency objectives and non-safety availability. They do not apply to safety invariants, missed high-risk escalation, unauthorized closure, silent data loss, evidence authorization bypass, or failed restore verification.

When an efficiency error budget is exhausted:

1. freeze non-essential releases affecting the SLI;
2. prioritize reliability work;
3. conduct a driver review;
4. resume only after the SLI is back within target and the owner approves.

## Safe degradation expectations

- Redis unavailable: persist outbox intent; retry with bounded backoff; never drop intent.
- Object storage unavailable: keep metadata and mark evidence unavailable; do not claim verification.
- Dashboard stale: show explicit stale state and disable critical actions.
- Notification adapter unavailable: retain durable pending/dead-letter state and surface escalation.
- PostgreSQL unavailable: reject mutation safely; do not accept an event without durable persistence.
- Partial network partition: prefer duplicate-safe retries over silent success.

## Observability privacy controls

Metrics, logs, and traces must not contain names, phone numbers, medical narratives, exact evidence content, object keys, access tokens, or raw precise coordinates. Use event IDs, coarse region labels, categorical health states, bounded latency values, and hashed/rotated correlation identifiers. Access to audit data follows least privilege and retention rules.

## Ownership

- Safety SLO owner: Reliability/Safety Lead.
- Data source owner: service owner for each SLI.
- Alert response owner: on-call Incident Commander.
- Release gate owner: Release Manager with Safety Lead approval.
