# ROS Eye resilient human-contact orchestration

## Authority boundary

This runtime executes the approved contracts from issues #28 and #29. It does not diagnose, prescribe, determine legal fault, guarantee help, dispatch a real authority, downgrade S3/S4, resolve a HumanSafetyCase, or close/reopen a road. Ambiguity, dependency loss, contradictory input, exhausted retries, and invalid state/version move toward `HUMAN_REVIEW` or `ESCALATED`.

## Mandatory protocol sequence

A contact session cannot start with a safety-indicator question. The runtime enforces the #29 sequence:

`CONSENT_PENDING → LANGUAGE_SELECTION → CONTACTING → AWAITING_RESPONSE`

- `open` creates `CONSENT_PENDING`, persists a deadline, and emits only the `contact.consent` prompt identifier.
- consent refusal, consent silence, or an out-of-order safety reply moves to `HUMAN_REVIEW` and cancels pending automation;
- consent approval moves to `LANGUAGE_SELECTION` and emits `contact.language` as a content-free orchestration identifier for an approved language-choice control;
- only a structured `LANGUAGE_SELECTED` callback may move to `CONTACTING`;
- the timer worker then applies the approved `CONTACTING → AWAITING_RESPONSE` transition and emits `contact.response`;
- partial response, disconnect, no-response, retry, escalation, and operator takeover continue through transitions permitted by the #29 state machine;
- the runtime never enters `COMPLETED` automatically.

`contact.language` is an orchestration key, not production wording. Channel adapters must map prompt identifiers only to separately approved, versioned content. The current Arabic prompt catalog remains `PLACEHOLDER_NOT_APPROVED`; the runtime does not embed or promote it to production medical text.

Automated callbacks may raise identity confidence only from `UNVERIFIED` to `PARTIAL`. They cannot mark identity `CONFIRMED`; confirmation remains a separately governed human-authority action.

## Tenant, case, and authenticated-context isolation

Every runtime command, callback, timer lease, inbox identity, outbox message, audit event, and repository lookup is scoped by the composite identity:

`tenantId + caseId + sessionId`

A globally unique session identifier is not treated as an authorization boundary. Callback adapters must provide authenticated tenant and case context matching the requested scope. Missing, mismatched, or unknown scope fails closed without creating an inbox record or mutating a target session.

Operator takeover additionally requires:

- authenticated tenant and case context;
- a human role of `OPERATOR`, `SUPERVISOR`, or `SAFETY_LEAD`;
- the current #29 contact-authority policy version;
- an immutable audit event recording the role that authorized the takeover.

PostgreSQL uses composite primary and foreign keys so inbox, outbox, and audit records cannot reference a session in another tenant or case.

## Durable transaction model

Each contact command is processed in one repository transaction:

1. lock/read the scoped contact session where the command requires an existing aggregate;
2. atomically claim the scoped inbox idempotency key;
3. evaluate the requested transition through `decideHumanContactTransition` from #29;
4. enforce optimistic `version` and update the session;
5. append one immutable structured audit event;
6. insert a deterministic scoped outbox message when the approved state requires contact.

The open-session path may stage its inbox key before the new session because the composite inbox foreign key is `DEFERRABLE INITIALLY DEFERRED`; both rows must commit together. Callback and takeover paths verify the scoped session before inserting their inbox identity, so an unknown cross-tenant/cross-case request fails closed rather than failing at transaction commit.

A process restart cannot lose a committed deadline or create a second logical contact attempt. Workers claim due sessions with expiring leases. A stale worker cannot advance a version owned by another worker.

## PostgreSQL adapter

`PostgresContactRuntimeRepository` is implemented over a vendor-neutral SQL pool/connection port; it does not import a database SDK. The production wrapper owns `BEGIN`, `COMMIT`, and `ROLLBACK` and supplies one connection per callback.

The adapter provides:

- composite scoped `SELECT ... FOR UPDATE` session access;
- `FOR UPDATE SKIP LOCKED` claims for due timers and outbox rows;
- optimistic scoped updates;
- inbox/outbox/audit insertion with composite keys;
- expiring lease and delivery-reservation recovery;
- cancellation fencing through an opaque delivery token rather than a database lock held across a network call.

## Durable outbox lifecycle and cancellation fence

Outbox delivery is a separate durable worker lifecycle:

1. claim due rows atomically with an expiring lease using `FOR UPDATE SKIP LOCKED`;
2. commit a short scoped reservation containing an opaque `delivery_token`, `delivery_started_at`, and `delivery_deadline_at`;
3. release the SQL transaction and connection completely;
4. call the vendor-neutral channel outside the database with the stable provider idempotency key, absolute deadline, and `AbortSignal`;
5. start a new short transaction and mark delivered or retry only if the same delivery token still exists, the message is not cancelled, and the deadline remains valid;
6. release or reclaim expired leases and reservations after timeout, crash, or restart.

The provider call never owns a PostgreSQL transaction, row lock, or pooled connection. The service rejects configurations where the provider timeout is not shorter than the outbox lease.

Operator takeover can therefore commit immediately while a provider is slow or hung. It cancels the message and clears its delivery token. Any later provider result cannot be acknowledged because finalization requires the exact live token and an uncancelled row. The channel receives an abort signal and must terminate work at the deadline; adapters that ignore it are not production-approved.

A crash after provider send but before database acknowledgement may repeat a transport call after the reservation expires. Therefore production channel adapters **must** enforce the stable tenant/case/session-scoped idempotency key. Providers unable to guarantee this are not production-approved. This preserves exactly-once logical contact without claiming impossible exactly-once network transport.

## Operator takeover

Operator takeover is a human action. In the same transaction it:

- verifies tenant/case/session ownership and authenticated tenant/case context;
- validates the human role and the #29 authority-policy version;
- evaluates the state transition through the #29 authority matrix;
- changes the session to `OPERATOR_TAKEOVER` only from an allowed state;
- records operator identity, authorized role, and immutable audit event;
- sets `automation_suppressed=true`;
- clears deadlines and timer leases;
- cancels pending automated outbox records and invalidates active delivery tokens.

No automated worker may resume while suppression is active. A hung provider cannot delay the takeover database transaction.

## Retry and failure behavior

- Automated contact attempts are bounded by the #29 contract.
- Deadlines are persisted as absolute timestamps for consent, language choice, structured response, retries, and provider delivery reservations.
- Due processing uses leases, optimistic versioning, and the approved transition matrix.
- `NO_RESPONSE` and `DISCONNECTED` move through `CONTACTING` before another `AWAITING_RESPONSE`; the runtime cannot jump directly across protocol states.
- Channel delivery has an enforceable AbortSignal-backed timeout shorter than the lease; timeout or outage records a capped durable backoff.
- A late provider success is not acknowledged after its token deadline; the stable idempotency key makes a subsequent retry logically safe.
- Contradictory callbacks, unavailable accessibility, and malformed, unauthenticated, mismatched, or out-of-order runtime context fail to human review.
- Retry exhaustion escalates; it never completes or resolves the safety case.
- Fallback channels remain local simulations (`SMS_SIM`, `TELEPHONY_SIM`) until separately approved.

## Data minimization

Runtime records contain scoped pseudonymous identifiers, states, deadlines, policy versions, reason codes, trace IDs, authorized roles, structured language choice, partial identity confidence, accessibility flags, and short-lived opaque delivery fences. They exclude raw conversation bodies, telephone numbers, medical narratives, replay tokens, and precise coordinates. General telemetry must use state/reason counters only.

## Acceptance evidence

Required deterministic proofs:

- no safety-indicator prompt is emitted before consent and explicit language selection;
- consent refusal/silence and language-selection silence fail to human review;
- out-of-order and duplicate callbacks fail closed or remain idempotent;
- automated callbacks cannot confirm identity;
- restart/resume preserves deadlines and exactly-one logical contact attempt;
- duplicate commands and callbacks are idempotent within tenant/case scope;
- cross-tenant or cross-case callback/takeover/inbox/lease access fails closed;
- stale version, timer races, and concurrent workers fail closed;
- bounded contact retries follow the approved states and escalate;
- a provider promise that never resolves is aborted at a deterministic deadline;
- provider execution occurs with zero open SQL transactions or row locks;
- operator takeover completes while a provider is hung and invalidates later acknowledgement;
- multiple provider failures cannot exhaust the PostgreSQL pool through held delivery transactions;
- outbox reservation/finalization, lease expiry, provider outage, and restart recovery are durable;
- crash after provider send repeats the same idempotency key only after reservation expiry and does not create a second logical delivery;
- PostgreSQL SQL contracts use composite predicates, short token reservations, and `FOR UPDATE SKIP LOCKED` claims;
- audit records include explicit authority role and remain append-only and tenant/case isolated;
- PostgreSQL migration, composite foreign keys, backup, and clean restore pass;
- CI, Security, Riyadh E2E/failure-mode, staging fault injection, and operational readiness remain green with SHA-bound evidence.
