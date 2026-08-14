# Gate C Frankfurt Region Remediation

## Status

- Gate: C / REL-013 immutable evidence archive
- Decision: **NO-GO / REGION REMEDIATION REQUIRED**
- Approved target region: **Frankfurt (`eu-central-1`)**
- Existing partial deployment: **`me-central-1`**
- Existing Terraform state must remain intact until the Frankfurt replacement is live and independently verified.

## Evidence baseline

Before remediation, the remote state was pulled read-only and backed up privately:

- AWS account: `094525993248`
- State lineage: `4686e681-5ae2-71f1-7bf3-c959fc387718`
- State serial: `2`
- Backup size: `80452` bytes
- Backup SHA-256: `37a9ac19218f9f8317cb2b84bb7f81a692a3d6e32222ca01fc416cbd69ce206b`

The backup is intentionally not committed to this public repository.

## Current condition

The prior Gate C plan targeted `me-central-1` and was partially applied. Current managed infrastructure includes the GitHub OIDC provider, archive IAM role/policy, evidence/audit S3 buckets, KMS key/alias, and related S3 controls in the wrong regional evidence plane. CloudTrail did not complete, and the independent verifier policy was not created.

Read-only discovery of `eu-central-1` confirmed no ROS REL-013 CloudTrail and no ROS KMS alias there. Frankfurt is therefore an empty target for this control.

## Safety invariants

Until a separately reviewed Frankfurt saved plan is approved:

1. Do not run `terraform apply` against the current root.
2. Do not reuse the old saved plan or its SHA-256.
3. Do not run `terraform destroy`, `state rm`, `state push`, ad-hoc `state mv`, or imports.
4. Do not migrate the existing backend as part of the region correction.
5. Do not delete or weaken Object Lock, versioning, KMS, public-access blocks, or retention on the `me-central-1` resources.
6. Do not configure the GitHub `ROS_EVIDENCE_*` variables until the Frankfurt stack is complete and independently verified.
7. Do not create another GitHub OIDC provider. The account-level provider already exists and must be reused.

## Remediation architecture

### Legacy plane — preserve, do not mutate during Gate C remediation

The current `me-central-1` state remains authoritative for the partial legacy deployment. Its resources are quarantined and must not become the active GitHub archive destination.

### Frankfurt target plane

Provision a new isolated Terraform root/state for `eu-central-1` with:

- evidence S3 bucket with Object Lock `COMPLIANCE`, versioning, SSE-KMS, public access blocked, TLS >=1.2;
- separate audit S3 bucket with the same immutable controls;
- customer-managed KMS key + alias in `eu-central-1`;
- CloudTrail whose home region is Frankfurt, multi-region enabled, log-file validation enabled, management events enabled, and evidence S3 data events enabled;
- read-only independent verifier policy;
- a dedicated Frankfurt GitHub archive IAM role/policy using the existing account-level GitHub OIDC provider.

The Frankfurt archive role must use a distinct name from the legacy role so that no two Terraform states manage the same IAM role or inline policy. GitHub repository variables will point only to the Frankfurt role/bucket/key after the live verification gate passes.

### Why the archive role is recreated instead of shared

The existing archive IAM role and inline policy are already owned by the legacy Terraform state. Managing the same IAM role or inline policy from a second Frankfurt state would create split ownership and state contention. The safer remediation is:

- reuse the singleton GitHub OIDC provider;
- create a distinct Frankfurt archive role with the same least-privilege trust model;
- leave the legacy role quarantined until post-Gate-C cleanup is separately approved.

This removes cross-state ownership while preserving the security boundary.

## State strategy

Use a separate state key for the Frankfurt root while leaving the existing backend bucket unchanged for this remediation. Backend location and workload region are independent concerns.

Recommended Frankfurt state key:

`ros/rel-013/evidence-store/eu-central-1/terraform.tfstate`

The existing legacy state key remains unchanged.

Any later backend relocation to Frankfurt is a separate governance change and must not be combined with Gate C remediation.

## Required code controls

The Frankfurt root must:

- fail closed unless `aws_region == "eu-central-1"`;
- set `create_github_oidc_provider = false`;
- require the exact existing GitHub OIDC provider ARN;
- use a Frankfurt-specific archive role name and verifier policy name;
- use Frankfurt-specific S3 bucket names;
- use `prevent_destroy` for both buckets and the KMS key;
- use `force_destroy = false`;
- enforce Object Lock `COMPLIANCE` and retention >=365 days;
- preserve the OIDC trust restrictions for repository ID `1310606342`, owner ID `125224479`, `refs/heads/main`, and workflow `Archive CI Evidence`;
- grant the writer no delete, retention-bypass, KMS administration, or wildcard sensitive write action;
- publish GitHub variables only from Frankfurt outputs.

## Plan gate

The first Frankfurt plan is not assumed to have the historical `22/0/0` count. The plan must instead be reviewed structurally.

Hard acceptance criteria:

- zero destroy actions;
- zero replacements of legacy resources;
- zero mutation of the existing `me-central-1` state;
- no duplicate OIDC provider creation;
- exactly one new Frankfurt evidence bucket and one new Frankfurt audit bucket;
- exactly one new Frankfurt KMS key/alias;
- exactly one new Frankfurt CloudTrail;
- exactly one dedicated Frankfurt archive role/policy;
- exactly one independent verifier policy;
- no retention downgrade, public exposure, static AWS keys, delete permissions, or governance-bypass permissions.

The saved plan receives a new SHA-256. Apply is fail-closed until both independent infrastructure/security review and explicit founder approval reference that exact digest.

## Execution sequence

1. Preserve and hash the current remote state — **PASS**.
2. Land and review the Frankfurt remediation code.
3. Run Terraform formatting/validation and repository CI on the remediation branch.
4. Merge only after protected checks and review pass.
5. Initialize the Frankfurt root against the existing encrypted backend using the new Frankfurt state key.
6. Produce a saved Frankfurt plan; do not apply.
7. Review the plan independently and record the exact SHA-256.
8. Obtain explicit founder approval for that exact SHA-256.
9. Apply only the unchanged approved saved plan.
10. Independently verify Frankfurt S3/KMS/CloudTrail/OIDC posture.
11. Configure `ROS_EVIDENCE_*` GitHub variables to Frankfurt outputs.
12. Produce the first live Archive CI Evidence receipt from clean `main`.
13. Independently verify VersionId, SHA-256, KMS, `COMPLIANCE` retention >=365 days, non-public posture, TLS, CloudTrail logging, and audit-bucket immutability.
14. Rerun the same archive workflow run and prove canonical VersionId reuse.
15. Only then mark Gate C PASS and consider REL-013 closure.

## Explicitly deferred cleanup

Cleanup of `me-central-1`, IAM legacy-role retirement, Terraform state splitting, or backend relocation is outside the remediation apply. These actions require a later separately reviewed plan after Frankfurt Gate C is PASS.
