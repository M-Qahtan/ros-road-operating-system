# ROS Eye privacy, security, consent and human oversight

## Authority boundary

This module provides technical controls and review evidence. It does not claim legal consent validity, clinical authority, government approval, emergency dispatch, guaranteed assistance, autonomous severity reduction, case resolution, or road action. Ambiguity and missing authorization fail closed.

## Purpose and minimum necessary data

Every read, write, export, deletion request, operator view and model recommendation is evaluated against the composite scope `tenantId + caseId`, actor role, approved purpose, lifecycle state, data kind and action. The default decision is deny. Data not listed as minimum necessary for the approved purpose is denied unless a valid, alerted, time-bounded break-glass lease applies.

Continuous monitoring is prohibited unless a purpose is approved and the lifecycle is `ACTIVE`. Revoked, expired, inactive and deletion-pending states stop normal processing. Legal hold permits only retention administration and scoped security review.

## Classification and telemetry boundary

- Signals, indicators, conversation metadata, evidence metadata and operator views are sensitive.
- Raw conversation, raw evidence, precise location and raw tokens are restricted.
- Restricted fields are masked by default and cannot be exported through the policy engine.
- Raw conversation, evidence, precise location, phone data, medical narrative and tokens are prohibited from general telemetry and CI artifacts.
- Encryption keys and vendor credentials remain outside domain records and are supplied through deployment-specific secret boundaries.

## Deny-by-default access control

RBAC and ABAC are combined. Authorization requires all of:

1. exact tenant and case match;
2. role permitted for the requested purpose;
3. lifecycle permits processing;
4. valid technical consent state where required;
5. requested data is minimum necessary;
6. action is allowed for the classification;
7. exceptional access, when used, is valid and scoped.

A session or resource identifier alone is never an authorization boundary.

## Break-glass

Break-glass is limited to safety operators and security reviewers. It requires a reason code, alert identifier, actor, purpose, tenant, case, issue time and expiry. Duration is capped at 15 minutes. It is never silent, permanent or cross-case. Expired, mismatched or previously reviewed leases do not grant access. Every use requires immutable audit and post-use review.

## Retention, deletion and legal hold

Vendor-neutral ports separate policy from storage. Deletion purges content while preserving immutable structured audit. Legal hold blocks content purge until released. Tenant and case remain part of every retention key. The database migration stores audit, break-glass and retention controls independently so deletion cannot erase accountability.

## Human oversight

High and critical recommendations require explicit human approval, an explanation identifier and reversibility where safe. A model recommendation never becomes authority by itself. Human override remains explicit and auditable. This policy does not weaken the #31 sequence `consent -> language -> contacting -> awaiting response`, durable deadlines, nonblocking outbox reservations, operator takeover, AbortSignal delivery deadlines or fail-closed transitions.

## Abuse controls

The runtime exposes vendor-neutral hooks for rate limits and anomaly review. The threat matrix covers source impersonation, stalking or monitoring abuse, account takeover, insider misuse, evidence exfiltration and model authority abuse. Each row names its control, deterministic test, accountable owner and residual risk. Residual P0 is not accepted by this implementation and requires founder governance.

## Release evidence

Required evidence on the final stable head:

- verify, build, lint, typecheck and tests;
- PostgreSQL migration, backup and clean restore;
- staging readiness and fault injection;
- Riyadh E2E and failure-mode safety;
- secret scan, dependency review and CycloneDX SBOM;
- operational readiness;
- evidence v2 binding candidate head, candidate base, tested merge, run ID and attempt;
- independent council and continuous assurance with no unresolved material blocker.
