# Runtime SLI/SLO Catalogue — Staging Preparation

Status: **proposed engineering defaults** for controlled staging/pilot preparation. These values are not approved production policy and do not authorize deployment, public-road operation, or live external dispatch.

## Purpose

This catalogue defines the runtime signals that must be observable before ROS can make a defensible `RUNTIME_READY_FOR_STAGING` claim. Safety-critical conditions page immediately; capacity trends warn before they become safety incidents.

## Proposed service-level indicators

| SLI | Measurement | Proposed staging signal | Alert class | Rationale |
|---|---|---:|---|---|
| PostgreSQL readiness | verified connection/readiness state | must be `true` | page | persistent safety state must fail closed when unavailable |
| Redis readiness | verified runtime broker state | must be `true` | page | worker delivery must not silently degrade to in-memory behavior |
| Dead-letter count | terminal Outbox delivery rows | `0` | page | any terminal delivery failure requires operator review |
| Stranded idempotency reservations | reservations requiring reconciliation | `0` | page | ambiguous command outcome must remain blocked/review-required |
| Outbox backlog | ready unpublished rows | `<= 1000` | warning | rising backlog is an early delivery-capacity signal |
| Oldest ready Outbox age | seconds since oldest ready unpublished event | `<= 60s` | warning | detects queue delay even when count is modest |
| PostgreSQL pool utilization | checked-out / configured max | `<= 0.80` | warning | preserves headroom for safety-critical work and recovery |
| Outbox logical delivery integrity | unique published IDs / intended logical events | `100%` with zero duplicates | gate | at-least-once infrastructure must not create duplicate logical actions |
| Worker expired-lease recovery | expired owned event reclaimed by a new worker | required PASS | gate | proves crash/restart recovery |
| Active-lease fencing | unexpired lease cannot be stolen | required PASS | gate | prevents concurrent duplicate handling |
| Ambiguous command completion | domain/audit/outbox committed but replay record absent | must remain blocked | gate | prevents duplicate safety-critical mutation after the highest-risk crash window |

## Alert semantics

### Page-level

Page-level signals require immediate operator/SRE attention in staging preparation:

- PostgreSQL or Redis is not ready;
- any dead-letter exists;
- any idempotency reservation is classified as requiring reconciliation.

A page is **not** permission to auto-retry a safety-critical command. Idempotency reconciliation remains governed by `idempotency-reconciliation.md`.

### Warning-level

Warnings indicate capacity or latency pressure and require investigation before promotion:

- Outbox backlog exceeds the proposed threshold;
- oldest ready Outbox event exceeds the proposed age threshold;
- PostgreSQL pool utilization exceeds the proposed threshold.

Warnings do not weaken fail-closed behavior or human authority.

## Evidence requirements

A runtime-resilience candidate should produce SHA-bound evidence that demonstrates at minimum:

1. bounded PostgreSQL pool pressure with all probes completing;
2. a deterministic Outbox load baseline with no lost or duplicate logical deliveries;
3. expired worker lease recovery after simulated restart;
4. active lease fencing until expiry;
5. crash-before-commit leaves a durable idempotency reservation and blocks automatic retry;
6. a domain commit followed by failure before replay persistence leaves RoadEvent, audit and Outbox committed exactly once, leaves no replay record, retains the reservation, and prevents a fresh process from re-running the guarded callback;
7. completed replay survives a new application composition/process instance;
8. completed replay plus leftover reservation can be reconciled only with the exact fence token, without re-executing the logical command;
9. stranded reservation state maps to a page-level alert;
10. tenant/purpose scope remains enforced throughout the tested runtime path.

## Promotion boundary

Passing these proposed staging thresholds is necessary evidence, not sufficient production approval. Long-duration soak, production-sized capacity testing, approved infrastructure sizing, production alert routing/on-call ownership, and live credentials/trust remain separate gates.