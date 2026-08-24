# ROS AWS Staging Runtime — PLAN_ONLY Proposal

This directory defines the first reviewable ROS runtime staging topology for Riyadh (`me-central-1`). It is an **infrastructure proposal**, not a deployment authorization.

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

The only current cloud execution authority is **PLAN_ONLY**. A future apply requires a separate founder authorization naming the exact reviewed binary plan SHA-256, AWS account, region and scope. Regenerating the plan invalidates that authorization.

## Proposed topology

- isolated VPC in `me-central-1` across at least two AZs;
- private application and data subnets; no Internet Gateway and no NAT Gateway in this slice;
- private AWS endpoints for ECR, CloudWatch Logs, Secrets Manager, KMS, STS and S3;
- internal HTTPS ALB only;
- ECS/Fargate API and outbox-worker services, minimum two tasks each;
- exact reviewed Fargate platform version; `LATEST` is forbidden;
- immutable account-local ECR images pinned with `@sha256:` digests;
- PostgreSQL Multi-AZ with encryption, TLS enforcement, backups and deletion protection;
- Redis replication group with Multi-AZ failover, TLS, authentication and encryption;
- private S3 evidence store with Versioning + KMS + Object Lock COMPLIANCE >=365 days;
- runtime evidence IAM limited to direct object read/write operations; no object delete or bucket enumeration authority;
- Secrets Manager boundary for database URL, RDS CA bundle and Redis URL;
- CloudWatch/Container Insights and an SNS alarm channel encrypted with a dedicated customer-managed KMS key;
- dedicated CloudTrail audit bucket, separate from evidence storage, with KMS + Versioning + Object Lock COMPLIANCE >=365 days;
- CloudTrail log-file integrity validation plus management events and S3 object data events for the evidence bucket;
- ECS task roles rather than long-lived AWS credentials.

## Required code dependencies

PR #114 is merged into `main` and provides automatically rotated ECS/Fargate task-role credentials through the fixed ECS relative credential endpoint. Staging must inherit that merged runtime; long-lived object-storage access keys are not an approved substitute.

PR #117 is merged into `main` and makes evidence quarantine **copy, verify, and retain source** while the Evidence repository marks the record `QUARANTINED`. The runtime therefore no longer requires S3 delete authority for quarantine.

PR #118 is the remaining Object Lock upload-integrity prerequisite. It binds the explicit SHA-256 checksum algorithm declaration into the presigned upload contract so S3 Object Lock default retention can accept evidence uploads without weakening integrity verification. Do not claim the staging evidence path operationally complete until #118 is merged and this IaC is rebuilt/reverified from the resulting `main`.

The core API currently treats object storage as an external release gate. This Terraform proposal creates the evidence storage boundary but does not claim that the Evidence HTTP/API surface is activated in the running API.

## Evidence and audit boundary

The evidence bucket and CloudTrail destination bucket are deliberately separate. The audit trail records management activity and object-level S3 data events for the evidence bucket. CloudTrail log delivery goes to the dedicated immutable audit bucket so CloudTrail does not recursively audit its own destination writes as evidence-bucket activity.

Both evidence and audit retention are configured for Object Lock **COMPLIANCE** mode with a minimum of 365 days. CloudTrail log-file validation is enabled. A successful Terraform validation proves only configuration validity; a later real PLAN_ONLY plan must still prove the exact in-region resource graph and policies.

## Identity boundary

The task runs with `NODE_ENV=production`, `ROS_RUNTIME_PROFILE=persistent` and `ROS_AUTH_PROFILE=oidc` so the strongest runtime validation remains active in staging.

OIDC issuer/JWKS/audience/bindings are mandatory. The module deliberately does not add unrestricted Internet egress. The supplied identity CIDR must be RFC1918 and the corresponding private connectivity must have a human review reference. If the approved identity provider cannot be reached through that private path, planning is NO-GO until a separately governed connectivity design is approved.

## Sensitive-data handling

Never commit:

- AWS credentials or session tokens;
- database/Redis passwords;
- private keys;
- real OIDC client secrets;
- raw Terraform plan JSON;
- real incident/evidence/medical/legal payloads.

Terraform plan JSON can contain sensitive values even when marked sensitive. During a real PLAN_ONLY session, analyze `terraform show -json` in memory only and retain only the bounded sanitized summary plus the binary `tfplan` digest required by `ros-staging-cloud-review/v1`.

## Local/static validation

No AWS credentials are required for repository validation:

```bash
terraform -chdir=infrastructure/staging/aws fmt -check -recursive
terraform -chdir=infrastructure/staging/aws init -backend=false -input=false -lockfile=readonly -no-color
terraform -chdir=infrastructure/staging/aws validate -no-color
```

The CI workflow performs only these non-mutating checks and verifies the reviewed provider lock remains unchanged.

## Real PLAN_ONLY prerequisites

Before generating a real plan, freeze and independently review:

1. exact merged ROS candidate SHA, including the WORM-safe quarantine and Object Lock upload-integrity behavior;
2. exact API and worker ECR image digests;
3. exact supported Fargate platform version in `me-central-1`;
4. approved AWS account and `me-central-1` access using short-lived SSO/OIDC credentials;
5. ACM certificate ARN for the internal endpoint;
6. exact supported PostgreSQL and Redis engine versions in-region;
7. approved RDS CA PEM;
8. approved OIDC issuer/JWKS/audience/client/tenant/purpose bindings;
9. approved private identity connectivity reference;
10. on-call and rollback owners;
11. evidence and audit retention >=365 days with CloudTrail S3 data events and log validation represented in the exact plan;
12. zero unresolved P0/P1 findings for the staging slice.

A successful static validation is **not** a real Terraform plan and is **not** deployment readiness.
