# ADR-001: Human authority and vendor-neutral safety contracts

## Status

Proposed for issue #28; runtime adoption remains gated by #19–#22.

## Decision

1. `HumanSafetyCase` is the authoritative aggregate for contact, review, escalation, transfer, monitoring, and resolution.
2. Domain/application contracts contain no telephony, cloud, device, vehicle, storage, or AI vendor SDK types.
3. Channel, signal, storage, notification, model, and external-authority capabilities are ports implemented by adapters.
4. Deterministic rules precede learned models. Model outputs are versioned recommendations with confidence, uncertainty, reason codes, and missing-evidence flags.
5. Machines may escalate upward but cannot diagnose, determine legal fault, dispatch a real authority, downgrade S3/S4, resolve a high-risk case, or reopen a road.
6. High-risk resolution authorization is human, reasoned, version-bound, expiring on material evidence/state change, and immutable in audit history.
7. Ambiguity, contradiction, missing evidence, connectivity loss, stale state, or unhealthy dependencies fail toward review/escalation.

## Consequences

- Safety authority remains explicit and testable.
- Adapters can change without contaminating the safety domain.
- More human review may occur during uncertainty; this is intentional and preferable to false reassurance.
- Downstream issues must implement durable timers, idempotency, provenance, least privilege, and audit evidence compatible with these contracts.
