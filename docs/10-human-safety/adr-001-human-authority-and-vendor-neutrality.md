# ADR-001: Human authority and vendor-neutral safety contracts

## Status

Accepted for issue #28 contract foundation; runtime adoption remains gated by the ROS Eye implementation waves and release evidence.

## Decision

1. `HumanSafetyCase` is the authoritative aggregate for contact, review, escalation, transfer, monitoring, and resolution.
2. Domain/application contracts contain no telephony, cloud, device, vehicle, storage, or AI vendor SDK types.
3. Channel, signal, storage, notification, model, external-authority, and replay/nonce capabilities are ports implemented by adapters.
4. Deterministic rules precede learned models. Model outputs are versioned recommendations with confidence, uncertainty, reason codes, and missing-evidence flags.
5. Machines may escalate upward but cannot diagnose, determine legal fault, dispatch a real authority, downgrade S3/S4, resolve a high-risk case, or reopen a road.
6. High-risk resolution authorization is human, reasoned, version-bound, expiring on material evidence/state change, and immutable in audit history.
7. Ambiguity, contradiction, missing evidence, connectivity loss, stale state, or unhealthy dependencies fail toward review/escalation.
8. Structural signal validation can never emit `ACCEPT`; mandatory acceptance orchestration must atomically consume a digest of the replay nonce before acceptance.
9. Replay uniqueness is global for the nonce TTL and keyed by `nonceDigest`; `scopeDigest` identifies source/signal/schema/purpose context for audit but cannot permit reuse of the same nonce in another scope.
10. Signal chronology is evaluated against trusted `evaluatedAt`: `occurredAt <= receivedAt <= evaluatedAt + allowedClockSkew`; stale signals exceed a versioned maximum age and cannot enter the automatic acceptance path.
11. Replay expiry is derived from the bounded minimum of sender `receivedAt` and trusted `evaluatedAt`, so future sender timestamps cannot extend nonce validity.
12. Audit/evidence may contain policy versions, nonce/scope digests, bounded expiry and consume outcome, but never raw replay tokens or sensitive payload narratives.

## Consequences

- Safety authority remains explicit and testable.
- Adapters can change without contaminating the safety domain.
- More human review may occur during uncertainty, replay-registry failure, clock skew, or stale input; this is intentional and preferable to false reassurance.
- A replay-registry adapter must provide atomic global uniqueness semantics for `nonceDigest`, including concurrent cross-scope attempts.
- Downstream issues must implement durable timers, idempotency, provenance, least privilege, temporal-policy evidence, and audit evidence compatible with these contracts.
