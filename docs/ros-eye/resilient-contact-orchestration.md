# ROS Eye resilient human-contact orchestration

## Authority boundary

This runtime executes the approved contracts from issues #28 and #29. It does not diagnose, prescribe, determine legal fault, guarantee help, dispatch a real authority, downgrade S3/S4, resolve a HumanSafetyCase, or close/reopen a road. Ambiguity, dependency loss, contradictory input, exhausted retries, and invalid state/version move toward `HUMAN_REVIEW` or `ESCALATED`.

## Durable transaction model

Each command is processed in one repository transaction:

1. atomically claim the inbox idempotency key;
2. lock/read the contact session and enforce optimistic `version`;
3. update the session;
4. append one immutable structured audit event;
5. insert a deterministic outbox message when contact is required.

A process restart therefore cannot lose a committed deadline or create a second logical contact attempt. Workers claim due sessions with expiring leases. A stale worker cannot advance a version owned by another worker. Outbox delivery uses deterministic idempotency keys and vendor-neutral channel ports.

## Operator takeover

Operator takeover is a human action. In the same transaction it:

- changes the session to `OPERATOR_TAKEOVER`;
- records the operator identifier and immutable audit event;
- sets `automation_suppressed=true`;
- clears deadlines and worker leases;
- cancels pending automated outbox records.

No automated worker may resume while suppression is active.

## Retry and failure behavior

- Automated attempts are bounded by the #29 contract.
- Deadlines are persisted as absolute timestamps.
- Due processing uses leases and optimistic versioning.
- Channel outage returns retry rather than claiming delivery.
- Contradictory callbacks and malformed runtime context fail to human review.
- Retry exhaustion escalates; it never completes or resolves the safety case.
- Fallback channels remain local simulations (`SMS_SIM`, `TELEPHONY_SIM`) until separately approved.

## Data minimization

Runtime records contain structured identifiers, states, deadlines, policy versions, reason codes, trace IDs, and accessibility flags. They exclude raw conversation bodies, telephone numbers, medical narratives, replay tokens, and precise coordinates. General telemetry must use state/reason counters only.

## Acceptance evidence

Required deterministic proofs:

- restart/resume preserves deadline and exactly-one attempt;
- duplicate command/callback is idempotent;
- stale version and timer races fail closed;
- bounded retries escalate;
- operator takeover suppresses automation atomically;
- dependency outage recovers without false delivery;
- audit records are append-only;
- PostgreSQL migration, backup and clean restore pass;
- CI, Security, Riyadh E2E/failure-mode, staging fault injection and operational readiness remain green with SHA-bound evidence.
