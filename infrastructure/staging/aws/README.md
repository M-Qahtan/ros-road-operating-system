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
- immutable account-local ECR images pinned with `@sha256:` digests;
- PostgreSQL Multi-AZ with encryption, TLS enforcement, backups and deletion protection;
- Redis replication group with Multi-AZ failover, TLS, authentication and encryption;
- private S3 evidence store with Versioning + KMS + Object Lock COMPLIANCE >=365 days;
- Secrets Manager boundary for database URL, RDS CA bundle and Redis URL;
- CloudWatch/Container Insights and SNS-backed staging alarms;
- ECS task roles rather than long-lived AWS credentials.

## Required code dependency

The staging API task role is intended to provide automatically rotated object-storage credentials through the ECS task-role container credential endpoint. ROS runtime support for that boundary is tracked in PR #114. Do not claim the object-storage runtime path ready until that exact code is merged and reverified.

The core API currently treats object storage as an external release gate. This Terraform proposal creates the evidence storage boundary but does not claim that the Evidence HTTP/API surface is activated in the running API.

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
terraform -chdir=infrastructure/staging/aws init -backend=false -input=false -no-color
terraform -chdir=infrastructure/staging/aws validate -no-color
```

The CI workflow performs only these non-mutating checks.

## Real PLAN_ONLY prerequisites

Before generating a real plan, freeze and independently review:

1. exact merged ROS candidate SHA;
2. exact API and worker ECR image digests;
3. approved AWS account and `me-central-1` access using short-lived SSO/OIDC credentials;
4. ACM certificate ARN for the internal endpoint;
5. exact supported PostgreSQL and Redis engine versions in-region;
6. approved RDS CA PEM;
7. approved OIDC issuer/JWKS/audience/client/tenant/purpose bindings;
8. approved private identity connectivity reference;
9. on-call and rollback owners;
10. zero unresolved P0/P1 findings for the staging slice.

A successful static validation is **not** a real Terraform plan and is **not** deployment readiness.
