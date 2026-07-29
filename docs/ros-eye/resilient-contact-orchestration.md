# ROS Eye resilient human-contact orchestration

## Authority boundary

This runtime executes the approved contracts from issues #28 and #29. It does not diagnose, prescribe, determine legal fault, guarantee help, dispatch a real authority, downgrade S3/S4, resolve a HumanSafetyCase, or close/reopen a road. Ambiguity, dependency loss, contradictory input, exhausted retries, and invalid state/version move toward `HUMAN_REVIEW` or `ESCALATED`.

## Tenant and case isolation

Every runtime command, callback, timer lease, inbox identity, outbox message, audit event, and repository lookup is scoped by the composite identity:

`tenantId + caseId + sessionId`

A globally unique session identifier is not treated as an authorization boundary. Missing or mismatched tenant/case context fails closed without mutating the target session. Operator takeover additionally requires authenticated tenant context and the recorded operator-authority policy version.

PostgreSQL uses composite primary and foreign keys so inbox, outbox, and audit records cannot reference a session in another tenant or case.

## Durable transaction model

Each contact command is processed in one repository transaction:

1. atomically claim the scoped inbox idempotency key;
2. lock/read the scoped contact session and enforce optimistic `version`;
3. update the session;
4. append one immutable structured audit event;
5. insert a deterministic scoped outbox message when contact is required.

A process restart therefore cannot lose a committed deadline or create a second logical contact attempt. Workers claim due sessions with expiring leases. A stale worker cannot advance a version owned by another worker.

## Durable outbox lifecycle

Outbox delivery is a separate durable worker lifecycle:

1. claim due rows atomically with an expiring lease (`FOR UPDATE SKIP LOCKED` or equivalent);
2. recheck tenant/case/session scope and cancellation fencing;
3. send through a vendor-neutral channel using a stable provider idempotency key;
4. durably mark `delivered_at`, or record a bounded retry time and structured error code;
5. release or reclaim an expired lease after crash/restart.

Two workers cannot own the same live lease. A crash after claim is recovered after lease expiry. A crash after provider send but before database acknowledgement may repeat a transport call, but the stable provider idempotency key preserves exactly-once logical contact. Providers that cannot honor idempotency are not production-approved.

Operator takeover cancels pending outbox rows in the same transaction as suppression. Delivery acknowledgement is fenced by tenant/case/session, message ID, lease owner, and cancellation state, preventing a claimed message from being marked delivered after takeover.

## Operator takeover

Operator takeover is a human action. In the same transaction it:

- verifies tenant/case/session ownership and authenticated tenant context;
- validates the operator authority policy version;
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
- Channel outage records a bounded durable retry rather than claiming delivery.
- Contradictory callbacks and malformed or mismatched runtime context fail to human review.
- Retry exhaustion escalates; it never completes or resolves the safety case.
- Fallback channels remain local simulations (`SMS_SIM`, `TELEPHONY_SIM`) until separately approved.

## Data minimization

Runtime records contain scoped pseudonymous identifiers, states, deadlines, policy versions, reason codes, trace IDs, and accessibility flags. They exclude raw conversation bodies, telephone numbers, medical narratives, replay tokens, and precise coordinates. General telemetry must use state/reason counters only.

## Acceptance evidence

Required deterministic proofs:

- restart/resume preserves deadlines and exactly-one logical attempt;
- duplicate commands and callbacks are idempotent within tenant/case scope;
- cross-tenant or cross-case callback/takeover/lease access fails closed;
- stale version, timer races, and concurrent workers fail closed;
- bounded retries escalate;
- operator takeover suppresses automation and fences claimed outbox messages atomically;
- outbox claim/ack/retry, lease expiry, provider outage, and restart recovery are durable;
- provider calls use a stable scoped idempotency key;
- audit records are append-only and tenant/case isolated;
- PostgreSQL migration, composite foreign keys, backup, and clean restore pass;
- CI, Security, Riyadh E2E/failure-mode, staging fault injection, and operational readiness remain green with SHA-bound evidence.
