# Operational readiness and release gates

## Release decision

A release candidate is acceptable only when all mandatory gates complete with the exact result `success` on the same candidate head, reviewed base, and tested merge revision. Missing, stale, skipped, cancelled, or failed evidence is treated as a failed release decision.

## Mandatory gates

1. Repository verification, build, lint, typecheck, and automated tests.
2. PostgreSQL/PostGIS migrations, persistence invariants, backup, and clean restore within the engineering RTO.
3. Isolated staging readiness and controlled Redis/object-storage fault injection with fail-closed readiness and verified recovery.
4. Deterministic Riyadh vertical-slice E2E evidence.
5. Riyadh failure-mode safety evidence covering the complete hazard set.
6. Security dependency audit, tracked-file secret scanning, immutable action pins, and CycloneDX SBOM evidence.
7. Final operational-readiness decision tied to the candidate and tested merge SHAs.
8. Active `main` ruleset enforcement with no routine bypass.
9. A successful external evidence receipt for every release-relevant source run, with verified KMS encryption, S3 version ID, SHA-256, `COMPLIANCE` Object Lock, and effective retention of at least 365 days.
10. Terraform formatting, backend-disabled initialization, and provider-backed validation for the external evidence root; live plan/apply approval remains a separate gate.

## Non-authorized capabilities

Passing these gates does not authorize:

- medical diagnosis or clinical decision-making;
- legal fault determination or attribution of liability;
- real government dispatch, emergency-agency instruction, or production integration;
- autonomous S3/S4 downgrade or resolution;
- autonomous road closure or reopening.

Those actions remain outside the software's authority and require approved human, legal, medical, governmental, and operational governance.

## Fail-closed release behavior

Release is blocked when:

- any upstream job result is not exactly `success`;
- restore verification fails or exceeds its approved engineering RTO;
- readiness remains healthy during a dependency outage that should make the service unready;
- liveness is lost during a controlled dependency fault without an approved architecture reason;
- recovery cannot be demonstrated;
- evidence is absent, empty, malformed, stale, or associated with another commit;
- the external archive receipt is absent, points to another source run/SHA, lacks a version ID, or fails KMS/checksum/Object-Lock/retention verification;
- security, privacy, audit, or human-authority boundaries are weakened;
- a required conversation or material review finding remains unresolved.

## Rollback and recovery

Every release decision records the candidate SHA, approved change scope, rollback trigger, rollback owner, and evidence locations. A failed post-merge required gate initiates rollback or forward-fix according to the safest reversible option. No rollback may erase incident, evidence, or audit history.

## Approval boundary

The workflow proves technical readiness. Production release, government integration, or field deployment still requires the founder or delegated release authority, safety owner, security owner, and applicable governmental or legal approvals.
