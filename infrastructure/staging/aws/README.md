# ROS AWS Staging Runtime — Riyadh PLAN_ONLY Proposal (R2)

This directory defines the reviewable ROS runtime staging topology for Riyadh (`me-central-1`). It is an **infrastructure proposal only**. It is not a deployment authorization and it does not itself create or modify AWS resources.

## Authority boundary

This module does not authorize or perform:

- `terraform apply`;
- production deployment;
- public-road operation;
- live emergency/government dispatch;
- real partner activation;
- live camera ingestion;
- vehicle actuation;
- autonomous S3/S4 authority.

Any future real Terraform plan is a separate **PLAN_ONLY** operation. A later apply, if ever approved, requires a new founder authorization bound to the exact reviewed binary `tfplan` SHA-256, AWS account, region, scope and evidence package. Regenerating or changing the plan invalidates that authorization.

## Proposed topology

- isolated VPC in `me-central-1` across at least two AZs;
- private application and data subnets; no Internet Gateway and no NAT Gateway in this slice;
- private AWS endpoints for ECR, CloudWatch Logs, Secrets Manager, KMS, STS and S3;
- internal HTTPS ALB only;
- ECS/Fargate API and outbox-worker services, minimum two tasks each;
- exact reviewed Fargate platform version; `LATEST` is forbidden;
- immutable account-local ECR images pinned with `@sha256:` digests;
- PostgreSQL Multi-AZ with encryption, forced TLS, backups and deletion protection;
- Redis replication group with Multi-AZ failover, TLS, authentication and encryption;
- private S3 evidence store with Versioning + KMS + Object Lock COMPLIANCE >=365 days;
- runtime evidence IAM limited to direct object read/write operations; no object delete, bucket enumeration, per-object retention or legal-hold authority;
- Secrets Manager boundary for database URL, RDS CA bundle and Redis URL;
- CloudWatch/Container Insights and an SNS alarm channel encrypted with a dedicated customer-managed KMS key;
- VPC Flow Logs for **ALL** VPC traffic at a 60-second aggregation interval, delivered to a dedicated KMS-encrypted CloudWatch log group through a scoped service role;
- dedicated CloudTrail audit bucket, separate from evidence storage, with KMS + Versioning + Object Lock COMPLIANCE >=365 days;
- CloudTrail log-file validation plus management events and S3 object data events for the evidence bucket;
- ECS task roles rather than long-lived AWS credentials.

## Required runtime/evidence contracts

The staging proposal assumes the reviewed runtime line containing these prerequisites:

1. rotating ECS/Fargate task-role credentials; long-lived object-storage keys are not an approved substitute;
2. evidence quarantine is **copy + verify + retain source**, so S3 delete authority is not required for quarantine;
3. presigned evidence uploads bind the explicit SHA-256 checksum algorithm required by the Object Lock upload contract;
4. `MVP_BOUNDED_RETENTION` fails closed before an upload intent is issued when `legalHold=true` or `retainUntil` exceeds the 365-day MVP guarantee.

The R2 IaC branch is intentionally stacked on the current bounded-retention candidate while that candidate completes its independent merge gate. No CI or review evidence from the stacked state may be reused after the base changes. Once the prerequisite is merged, this IaC must be reconciled to the resulting exact `main` and reverified from scratch before it can become Ready-for-Review.

## MVP retention contract

For the MVP, the only storage guarantee claimed by ROS is the bucket-level S3 Object Lock **COMPLIANCE** floor of at least 365 days.

- `legalHold=true` is unsupported and must fail closed in the application before an upload intent is issued;
- `retainUntil` beyond the guaranteed MVP window must fail closed;
- no per-object retention/legal-hold IAM privileges are added merely to satisfy a wider domain model;
- full legal-hold/per-object retention remains a separately designed and authorized production capability.

This prevents ROS from claiming an evidence-retention capability that the current storage/IAM boundary cannot prove.

## Evidence, network-forensics and audit boundary

The evidence bucket and CloudTrail destination bucket are deliberately separate. The trail records management activity and object-level S3 data events for the evidence bucket. CloudTrail delivery goes to the dedicated immutable audit bucket, avoiding recursive evidence-bucket audit design.

VPC Flow Logs provide a distinct network-forensics plane for accepted and rejected IP traffic. They are delivered to a KMS-encrypted CloudWatch Logs group through a role assumable only by the VPC Flow Logs service under the expected account/flow-log ARN boundary. Flow Logs are observational only and do not alter packet handling.

Both evidence and audit retention use Object Lock **COMPLIANCE** mode with a minimum of 365 days. CloudTrail log-file validation is enabled. A successful Terraform validation proves configuration validity only; a later real PLAN_ONLY plan must still prove the exact in-region resource graph, service availability, IAM/KMS policies and plan digest.

## Identity boundary

The task runs with `NODE_ENV=production`, `ROS_RUNTIME_PROFILE=persistent` and `ROS_AUTH_PROFILE=oidc` so the strongest runtime validation remains active in staging.

OIDC issuer/JWKS/audience/bindings are mandatory. The module deliberately adds no unrestricted Internet egress. `identity_private_cidr` must be RFC1918 and its connectivity must have an explicit human review reference. If the approved identity provider cannot be reached through that private path, the real plan is **NO-GO** until a separately governed connectivity design is approved.

## Sensitive-data handling

Never commit:

- AWS credentials or session tokens;
- database/Redis passwords;
- private keys;
- real OIDC client secrets;
- raw Terraform plan JSON;
- real incident/evidence/medical/legal payloads;
- live account-specific backend configuration.

Terraform plan JSON can contain sensitive values even when Terraform marks them sensitive. During a real PLAN_ONLY session, analyze `terraform show -json` in memory and retain only the bounded sanitized review package plus the exact binary `tfplan` digest.

## Static validation

Repository validation uses no AWS credentials:

```bash
terraform -chdir=infrastructure/staging/aws fmt -check -recursive
terraform -chdir=infrastructure/staging/aws init -backend=false -input=false -lockfile=readonly -no-color
terraform -chdir=infrastructure/staging/aws validate -no-color
```

The CI workflow performs only these non-mutating checks and verifies that the reviewed provider lock remains unchanged.

## Real PLAN_ONLY prerequisites

Before a real plan can be generated, freeze and independently review:

1. exact merged ROS candidate SHA containing the WORM-safe quarantine, Object Lock upload-integrity and MVP bounded-retention behavior;
2. exact API and worker ECR image digests;
3. exact supported Fargate platform version in `me-central-1`;
4. approved AWS account and `me-central-1` access using short-lived SSO/OIDC credentials;
5. ACM certificate ARN for the internal endpoint;
6. exact supported PostgreSQL and Redis engine versions in-region;
7. approved RDS CA PEM;
8. approved OIDC issuer/JWKS/audience/client/tenant/purpose bindings;
9. approved private identity connectivity review reference;
10. on-call and rollback owners;
11. VPC Flow Logs plus evidence/audit retention >=365 days, CloudTrail S3 data events and log-file validation represented in the exact plan;
12. zero unresolved P0/P1 findings for the staging slice.

A successful static validation is **not** a real Terraform plan, **not** deployment readiness and **not** production authorization.
