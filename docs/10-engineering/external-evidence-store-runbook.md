# ROS external immutable evidence store runbook

## Purpose and authority boundary

This runbook provisions and proves the external evidence store approved by the founder for REL-013 while keeping the source repository public. It does not authorize production deployment, public-road operation, real emergency integration, camera access, vehicle actuation, or a later work package.

REL-013 is closed only after all live acceptance checks in this runbook pass. A Terraform plan, a green unit test, or a requested retention value is not sufficient evidence.

## Approved architecture

| Control | Implementation |
| --- | --- |
| Primary evidence | Amazon S3 in `me-central-1` by default |
| Immutability | S3 Object Lock `COMPLIANCE`; bucket default ≥365 days; each upload explicitly requests ≥366 days to absorb clock and network delay |
| Version identity | S3 `VersionId` recorded for every artifact and receipt |
| Encryption | Customer-managed AWS KMS key with annual automatic rotation and S3 Bucket Keys |
| Public exposure | All four S3 public-access controls enabled; bucket policy must report non-public |
| Transport | TLS required; versions below TLS 1.2 denied |
| Workload identity | GitHub OIDC; no long-lived AWS access keys |
| Least privilege | GitHub role can append, verify, and set/extend `COMPLIANCE` retention only under `evidence/github/1310606342/*`; bucket policy rejects retention below 365 days, and the role has no delete or governance-bypass rights; KMS use is restricted to S3 in the approved account and evidence-bucket encryption context |
| Provenance | Same-repository successful run, immutable repository ID, source SHA, workflow/run/attempt, artifact ID, SHA-256, KMS key, object key, and version ID |
| Replay safety | Re-running the archive for the same source run/attempt and content reuses the already verified immutable artifact and receipt versions instead of creating new WORM versions; any mismatch fails closed |
| Audit | Multi-region CloudTrail S3 data events with digest validation, delivered to a separate KMS-encrypted Object-Locked audit bucket |
| Terraform safety | Evidence bucket, audit bucket, and KMS key use `prevent_destroy`; S3 `force_destroy` is false |

The privileged workflow is triggered only through `workflow_run` and checks out the trusted `main` event SHA explicitly. It downloads source artifacts as opaque ZIP bytes and never extracts or executes pull-request content. Fork runs and source runs that do not conclude `success` are rejected before AWS archival.

No lifecycle deletion rule is configured. The compliance lock is the minimum period during which deletion is technically impossible; reaching day 365 does not automatically delete evidence. Any later disposal requires a separately approved records-management decision.

## Prerequisites

- An AWS account approved for ROS program evidence and data residency.
- Terraform exactly `1.15.8` and AWS provider credentials with permission to create S3, KMS, IAM OIDC/roles, and CloudTrail resources.
- A protected `main` branch. The AWS trust is bound to repository ID `1310606342`, owner ID `125224479`, `refs/heads/main`, and workflow `Archive CI Evidence`.
- An organization-managed encrypted and locked Terraform backend. Its partial configuration must restrict `allowed_account_ids` to the approved 12-digit AWS account. Do not store production Terraform state in this public repository.
- The backend principal needs `s3:GetObject` and `s3:PutObject` only on the selected state key, plus `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on the matching `<key>.tflock`. It must not receive broad bucket write/delete access.
- GitHub CLI authenticated as a repository administrator for setting non-secret repository variables and, when a controlled first proof is needed, dispatching an eligible source workflow on `main` and observing the automatically triggered archive run.

Compliance mode is intentionally irreversible during an object's retention period. Test names and account/region choices before `terraform apply`; deleting the AWS account is the only early removal path documented by AWS for a compliance-locked version.

## 1. Initialize and produce the reviewed plan

From `infrastructure/evidence-store/aws`, copy `backend.hcl.example` outside the repository and point it to a pre-existing, versioned, KMS-encrypted, non-public Terraform state bucket with native S3 lockfiles:

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init -backend-config=/secure/path/ros-evidence-backend.hcl -input=false -lockfile=readonly
terraform fmt -check
terraform validate
terraform plan -input=false -lock-timeout=5m -out=rel-013.tfplan
terraform show -no-color rel-013.tfplan
sha256sum rel-013.tfplan
```

Choose a globally unique lowercase `evidence_bucket_name`. If the AWS account already has the GitHub Actions OIDC provider, set `create_github_oidc_provider = false` and provide its exact ARN instead of attempting to create a duplicate.

When this root creates the OIDC provider, the AWS provider omits a manually pinned certificate thumbprint so IAM retrieves the trusted top-intermediate CA. Do not reintroduce a leaf-certificate thumbprint that would rotate independently of this configuration.

The committed `.terraform.lock.hcl` pins the signed AWS provider for both `linux_amd64` CI and the founder's `windows_amd64` workstation. `-lockfile=readonly` makes initialization fail instead of silently changing that reviewed dependency selection. When a provider upgrade is intentionally approved, regenerate and review the lock file explicitly:

```bash
terraform providers lock -platform=linux_amd64 -platform=windows_amd64
git diff -- .terraform.lock.hcl
```

Review the saved plan and record its lowercase SHA-256 in the controlled approval record. Never commit `terraform.tfstate`, plan files, backend credentials, a plan transcript containing account identifiers, or a populated `terraform.tfvars` containing account-specific data.

For the first empty state, expect exactly `22 to add, 0 to change, 0 to destroy` when Terraform creates the GitHub OIDC provider, or `21 to add, 0 to change, 0 to destroy` when an existing provider ARN is supplied. Review the plan for exactly two Object-Locked buckets, one KMS key, one append-only GitHub role, one unattached read-only verifier policy, and one CloudTrail trail. Reject any unexpected count, update, deletion, replacement, bucket/key destruction, public access, governance mode, retention below 365, static IAM credentials, or wildcard write access. Attach `independent_verifier_policy_arn` only to a separately governed release/safety reviewer role, preferably through IAM Identity Center.

Do not run `apply` until the founder and the infrastructure/security reviewer approve the exact saved-plan SHA-256.

## 2. Apply the approved saved plan

Apply only the unchanged plan whose SHA-256 was approved. Recompute the digest immediately before `apply` and fail closed on any mismatch:

```bash
approved_plan_sha256="replace-with-approved-lowercase-sha256"
actual_plan_sha256="$(sha256sum rel-013.tfplan | cut -d ' ' -f 1)"
test "$actual_plan_sha256" = "$approved_plan_sha256"
terraform apply -input=false rel-013.tfplan
```

PowerShell equivalent:

```powershell
$approvedPlanSha256 = "replace-with-approved-lowercase-sha256"
$actualPlanSha256 = (Get-FileHash -LiteralPath ".\rel-013.tfplan" -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualPlanSha256 -ne $approvedPlanSha256) {
  throw "Saved Terraform plan digest does not match the approved SHA-256"
}
terraform apply -input=false ".\rel-013.tfplan"
```

## 3. Configure GitHub repository variables

The workflow uses repository variables, not secrets, because all values are identifiers and OIDC supplies temporary credentials. From the Terraform directory:

```bash
gh variable set ROS_EVIDENCE_AWS_ACCOUNT_ID --body "$(terraform output -raw aws_account_id)"
gh variable set ROS_EVIDENCE_AWS_REGION --body "$(terraform output -raw aws_region)"
gh variable set ROS_EVIDENCE_AWS_ROLE_ARN --body "$(terraform output -raw github_archive_role_arn)"
gh variable set ROS_EVIDENCE_BUCKET --body "$(terraform output -raw evidence_bucket_name)"
gh variable set ROS_EVIDENCE_KMS_KEY_ARN --body "$(terraform output -raw evidence_kms_key_arn)"
```

Do not create `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` repository secrets. Their presence would violate the approved keyless design.

PowerShell equivalent on the founder's Windows workstation:

```powershell
$evidence = terraform output -json github_repository_variables | ConvertFrom-Json
gh variable set ROS_EVIDENCE_AWS_ACCOUNT_ID --body $evidence.ROS_EVIDENCE_AWS_ACCOUNT_ID
gh variable set ROS_EVIDENCE_AWS_REGION --body $evidence.ROS_EVIDENCE_AWS_REGION
gh variable set ROS_EVIDENCE_AWS_ROLE_ARN --body $evidence.ROS_EVIDENCE_AWS_ROLE_ARN
gh variable set ROS_EVIDENCE_BUCKET --body $evidence.ROS_EVIDENCE_BUCKET
gh variable set ROS_EVIDENCE_KMS_KEY_ARN --body $evidence.ROS_EVIDENCE_KMS_KEY_ARN
```

## 4. Run the live proof

After the archiver exists on `main` and the repository variables are configured, produce or select a **successful same-repository subscribed source workflow run on `main`**. Do not dispatch `Archive CI Evidence` directly; it intentionally has no `workflow_dispatch` entry. The privileged archive must be started only by GitHub's `workflow_run` event after an eligible source workflow concludes successfully.

For a controlled first proof, `ROS Eye Pilot Readiness` is an eligible subscribed source workflow and supports manual dispatch on `main`:

```bash
gh workflow run ros-eye-pilot-readiness.yml --ref main
gh run list --workflow "ROS Eye Pilot Readiness" --branch main --limit 5
# Record the successful SOURCE_RUN_ID from the list, then:
gh run watch SOURCE_RUN_ID --exit-status

gh run list --workflow "Archive CI Evidence" --branch main --limit 10
# Select the archive run whose workflow_run source is SOURCE_RUN_ID, then:
gh run watch ARCHIVE_RUN_ID --exit-status
gh run view ARCHIVE_RUN_ID --log
```

Alternatively, use the first naturally occurring successful subscribed `main` run after merge. In both cases, verify that the archive run is causally bound to the selected source run and source SHA; do not substitute an unrelated successful run.

The archive job must publish a summary containing the source SHA, artifact count, receipt key, receipt version ID, receipt disposition, and immutable-through timestamp. Capture both the source workflow run URL and archive workflow run URL in the WP-00 evidence manifest.

### Controlled replay-idempotency proof

After the first archive run succeeds, perform one controlled rerun of that **same archive workflow run**. Do not create a different source run for this check:

```bash
gh run rerun ARCHIVE_RUN_ID
gh run watch ARCHIVE_RUN_ID --exit-status
gh run view ARCHIVE_RUN_ID --log
```

The rerun must report `reused existing immutable version`, return the same canonical receipt `VersionId`, and preserve the same artifact version IDs recorded by the receipt. A rerun that creates a new immutable version for identical source evidence fails this hardening check.

## 5. Independently verify AWS state

Use the bucket, receipt key, and receipt version ID from the successful workflow summary:

```bash
aws s3api get-object-lock-configuration --bucket "$ROS_EVIDENCE_BUCKET"
aws s3api get-bucket-versioning --bucket "$ROS_EVIDENCE_BUCKET"
aws s3api get-bucket-encryption --bucket "$ROS_EVIDENCE_BUCKET"
aws s3api get-public-access-block --bucket "$ROS_EVIDENCE_BUCKET"
aws s3api get-bucket-policy-status --bucket "$ROS_EVIDENCE_BUCKET"
aws s3api head-object --bucket "$ROS_EVIDENCE_BUCKET" --key "$RECEIPT_KEY" --version-id "$RECEIPT_VERSION_ID" --checksum-mode ENABLED
aws s3api get-object-retention --bucket "$ROS_EVIDENCE_BUCKET" --key "$RECEIPT_KEY" --version-id "$RECEIPT_VERSION_ID"
aws cloudtrail get-trail-status --name "ros-evidence-1310606342"
```

Use a separately administered read-only evidence role for this independent check. Do not expand the GitHub writer role or grant it deletion privileges.

## REL-013 live acceptance record

All items are mandatory:

- [ ] The repository remains public and the tested repository ID is `1310606342`.
- [ ] Terraform `validate` and plan review pass in the approved AWS account and region.
- [ ] Evidence and audit buckets have versioning `Enabled` and Object Lock `Enabled`.
- [ ] Default retention is `COMPLIANCE` and at least 365 days.
- [ ] Evidence objects and the receipt report `COMPLIANCE` with `retain-until - LastModified ≥365 days`.
- [ ] `head-object` reports `aws:kms`, the approved KMS key ARN, and the exact SHA-256 checksum.
- [ ] Every receipt entry records the source run/attempt, source SHA, artifact ID, object key, and non-empty S3 version ID.
- [ ] The bucket is non-public and all public-access-block flags are true.
- [ ] GitHub obtained AWS credentials through OIDC; no long-lived AWS keys exist in repository configuration.
- [ ] The GitHub role has the conditionally required `PutObjectRetention` permission, while the bucket policy denies retention below 365 days; it has no `DeleteObject`, `DeleteObjectVersion`, `BypassGovernanceRetention`, KMS administration, or wildcard actions.
- [ ] CloudTrail is logging and log-file validation is enabled; the audit bucket is independently WORM-protected.
- [ ] A controlled rerun for the same source run/attempt reuses the same canonical receipt `VersionId` and the receipt's existing artifact version IDs.
- [ ] An independent release/safety reviewer records the source run, receipt key/version, and archive workflow URL.

Only after this checklist and the remaining R1/R2/R3 CI gates pass may WP00-B004 / REL-013 change from `PROVISIONING REQUIRED` to `CLOSED`. The overall WP-00 decision remains separate and still requires the full tested-merge acceptance set.

## Failure and recovery

- Missing AWS variables, failed OIDC, an empty artifact set, a fork run, a source run whose conclusion is not `success`, a wrong repository ID, a public bucket, governance mode, wrong KMS key, missing `VersionId`, checksum mismatch, or retention below 365 fails the archive job closed.
- A controlled retry must preserve the original source run/attempt identity in the receipt. Do not treat a different source run as equivalent evidence merely because it tests the same commit.
- Re-running an already successful archive workflow for identical source evidence must reuse the verified existing artifact and receipt versions. If an existing deterministic key has mismatched metadata, checksum, KMS binding, retention, or receipt content, archival fails closed rather than writing another version.
- Disabling the workflow stops new archival but cannot erase existing objects.
- KMS key deletion must remain prohibited operationally. `prevent_destroy` blocks Terraform destruction, but AWS account administrators also need MFA, separation of duties, and alerts for key-disable or deletion-schedule attempts.
- A legal hold may extend protection. It must never be used to shorten or bypass the 365-day control.
