# ROS Eye privacy, security, consent and human oversight

## Authority boundary

This module provides technical controls and review evidence. It does not claim legal consent validity, clinical authority, government approval, emergency dispatch, guaranteed assistance, autonomous severity reduction, case resolution, or road action. Ambiguity and missing authorization fail closed.

## Purpose and minimum necessary data

Every request is evaluated against `tenantId + caseId`, authenticated `actorId`, role, approved purpose, lifecycle state, data kind and action. The default decision is deny. Continuous monitoring is prohibited unless purpose is approved and lifecycle is `ACTIVE`.

## Classification and telemetry

Signals, indicators, conversation metadata, evidence metadata and operator views are sensitive. Conversation bodies, evidence payloads, precise location and tokens are restricted. The pure policy evaluator never grants restricted access. Restricted exports remain denied. Sensitive payloads and exceptional-access receipts are excluded from general telemetry and CI artifacts.

## Deny-by-default access control

Authorization requires exact tenant/case scope, authenticated actor identity, role-purpose compatibility, valid lifecycle and consent state where required, minimum-necessary data, and an allowed action. A session, resource, lease, alert identifier or caller-supplied receipt is never proof of authorization.

## Durable break-glass protocol

Break-glass is limited to safety operators and security reviewers. A lease is capped at 15 minutes and bound to tenant, case, actor, role and purpose. Expired, reviewed, revoked, mismatched or replayed leases fail closed.

Restricted `FULL` access is granted only after one repository transaction proves:

1. actor, scope, lease, purpose, lifecycle, consent and policy version are valid;
2. abuse and rate-limit consumption returns `ALLOW`;
3. a durable alert outbox reservation is persisted with a repository-generated receipt;
4. an immutable use-audit event is appended and linked to that receipt;
5. the grant is finalized with database linkage to lease, abuse decision, alert reservation and audit event.

Any adapter failure, unknown state, conflict or missing receipt returns `DENY`. Duplicate requests use a stable scoped idempotency key and converge on one logical grant, one alert reservation and one audit intent.

Provider delivery is asynchronous and must not run inside the authorization transaction or while holding a long-lived PostgreSQL lock.

## Crash and race behavior

- A crash before finalization leaves no authorized grant.
- Reserved alert work is recoverable from the durable outbox.
- Concurrent duplicates converge on one grant identity.
- Expiry, review or revocation before finalization denies access.
- Cross-tenant, cross-case and cross-actor reuse is denied.
- Invented alert or audit identifiers cannot satisfy the database relationships required for authorization.

## Retention, deletion and legal hold

Deletion purges content while preserving immutable structured audit. Legal hold blocks content purge until released. Tenant and case remain part of every retention key.

## Human oversight

High and critical recommendations require explicit human approval, an explanation identifier and reversibility where safe. A model recommendation never becomes authority by itself. This policy does not weaken the #31 sequence `consent -> language -> contacting -> awaiting response`, durable deadlines, nonblocking outbox reservations, operator takeover, delivery deadlines or fail-closed transitions.

## Release evidence

The final stable head must pass verify, build, lint, typecheck, tests, PostgreSQL migration/backup/restore, staging readiness, Riyadh E2E, failure-mode safety, security, dependency review, secret scan, SBOM and operational readiness. Evidence v2 must bind candidate head, candidate base, tested merge, run ID and attempt, with no unresolved material blocker.
