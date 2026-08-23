# ROS Staging Cloud Governance — PLAN_ONLY

## Purpose

This document governs preparation of a future ROS cloud staging environment without authorizing infrastructure mutation. The executable review contract is `apps/api/src/runtime/staging-cloud-governance.ts` using schema `ros-staging-cloud-review/v1`.

The highest successful software decision is:

`STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW`

It always returns:

- `terraformApplyAuthorized = false`;
- `deploymentAuthorized = false`;
- `publicRoadAuthorized = false`;
- `externalIntegrationAuthorized = false`;
- `semanticClaimsRequireHumanReview = true`.

A green package is therefore a reviewable exact-plan proposal, never an apply/deploy authorization.

## Existing engineering targets preserved

The repository already defines pilot engineering recovery targets in `docs/09-reliability/recovery-drill.md`:

- RPO: **5 minutes**;
- RTO: **30 minutes** for a verified clean restore.

These remain internal engineering targets, not public service commitments. The staging review contract fails closed if a package silently changes either target. Any future change requires explicit reliability/safety governance rather than a package-level self-attestation.

## Terraform plan integrity

The review command accepts the actual Terraform binary plan file. It:

1. verifies the plan path is a regular non-symbolic-link file;
2. hashes the exact plan bytes with SHA-256 before analysis;
3. invokes `terraform show -json <plan>` with `execFile` and no shell;
4. hashes the exact plan bytes again after `terraform show` and rejects the review if the bytes changed during analysis;
5. parses the JSON output in memory only;
6. accepts Terraform plan JSON format major **1.x** and fails closed on an unsupported major format;
7. requires the plan to report `applyable=true`, `complete=true`, and `errored=false` before it can become review-ready;
8. derives create/update/read/no-op/delete/unknown-action counts from that exact plan;
9. treats resource-drift delete actions as review-blocking until dispositioned;
10. rejects unknown future Terraform action types rather than guessing their effect;
11. reads output sensitivity from `planned_values.outputs[*].sensitive` and rejects plans that expose sensitive planned outputs on the review surface.

The raw `terraform show -json` output must **not** be committed, uploaded as a general CI artifact, pasted into tickets, or archived as ordinary evidence. Terraform JSON can expose sensitive values even when Terraform marks them as sensitive. The review output retains only the binary plan digest and bounded derived summary.

`applyable=true` is necessary only to establish that Terraform regards the reviewed plan as a coherent apply candidate. It does **not** authorize `terraform apply`; this ROS governance layer still hard-codes `terraformApplyAuthorized=false` until a separate founder authorization names the exact reviewed plan digest and scope.

## Non-destructive review gate

Any action containing `delete` is a hard `NO_GO`, including replacement plans such as `delete + create` or `create + delete`. This is intentionally stricter than generic Terraform behavior because the current authority is plan preparation only.

A future decision to accept a destructive replacement requires a new explicit founder-authorized review scope. It must not be obtained by weakening this validator.

## Required staging evidence package

The package requires exactly one byte-verified evidence file for each of these categories:

- `BACKUP_RESTORE`;
- `FAULT_INJECTION`;
- `ROLLBACK_PLAN`;
- `OBSERVABILITY`;
- `INCIDENT_ONCALL`;
- `SECURITY_POSTURE`.

For every evidence file the verifier rejects symbolic links and root escape, requires a regular file, verifies byte size and streams the actual bytes through SHA-256.

These files may contain approved manifests, bounded reports or review records. They must not contain credentials, raw evidence payloads or unnecessary personal data.

## Required topology and operations claims

A review package must declare that the proposed staging design includes:

- high-availability application topology;
- managed/persistent PostgreSQL;
- managed/persistent Redis;
- object/evidence storage;
- worker/outbox topology;
- logs, metrics and traces;
- safety alerting;
- a defined on-call owner;
- defined rollback trigger and owner;
- short-lived cloud credentials only;
- zero unresolved P0/P1 findings.

The parser verifies package shape and evidence integrity, but these design declarations still require human architecture/security/reliability review. A boolean in the package is not a substitute for inspecting the Terraform plan, architecture and evidence.

## Credential and telemetry boundary

Long-lived cloud credentials are forbidden. Staging should use short-lived/OIDC-based credentials consistent with repository security governance.

General telemetry remains subject to `observability-data-policy.md`: no passwords, API keys, JWTs, database URLs with credentials, raw evidence payloads, unrestricted precise movement history, medical statements or other prohibited sensitive data may enter logs/metrics/traces.

## Authority boundary

A staging review package is immediately `NO_GO` if it proposes or claims any of the following:

- public-road enablement;
- real partner activation;
- live camera enablement;
- vehicle actuation;
- autonomous S3/S4 authority;
- long-lived cloud credentials;
- unresolved P0/P1 findings.

Passing staging planning never authorizes real emergency/government dispatch, medical diagnosis, legal fault determination, road closure/reopening or production operation.

## Review command

After building the API package:

`node dist/e2e/run-staging-cloud-review.js <package.json> <evidence-root> <expected-candidate-head-sha> <terraform-plan-file>`

The command independently binds:

- the exact package;
- the trusted candidate head;
- the exact Terraform binary plan digest and the semantics emitted by `terraform show -json` for that same file;
- all required evidence file bytes.

It exits non-zero unless the package reaches `STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW`.

## Founder review package

When a real staging plan is eventually generated under an authorized PLAN_ONLY session, the founder review should present at minimum:

- candidate head SHA;
- Terraform plan SHA-256;
- cloud account reference and region;
- Terraform JSON format and Terraform version;
- `applyable/complete/errored` state;
- create/update/read/no-op counts;
- confirmation of zero delete/unknown actions and zero sensitive planned outputs;
- RPO/RTO targets and evidence;
- rollback trigger/owner;
- on-call/reliability owner;
- observability/security posture;
- outstanding risks and external dependencies.

If the founder later chooses to authorize an apply, the authorization must name the **exact reviewed plan digest, account/region and scope**. Any plan regeneration, mutation, or digest change invalidates that authorization and requires re-review.

## Current boundary

This branch creates only the governance and verification mechanism. It does not run `terraform plan` against AWS, does not run `terraform apply`, does not mutate AWS/GitHub/database resources and does not deploy ROS.
