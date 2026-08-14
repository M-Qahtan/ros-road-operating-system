# Gate C Frankfurt Implementation Plan

## Authority and execution boundary

This document converts PR #74 from a region-remediation design note into an implementation-ready engineering plan for Gate C / REL-013.

It does **not** authorize Terraform execution. Until the later plan-approval gate is explicitly released, the following remain prohibited:

- `terraform plan`
- `terraform apply`
- `terraform destroy`
- `terraform import`
- `terraform state rm`
- `terraform state push`
- backend migration
- any mutation of the legacy `me-central-1` Terraform state or resources

The existing `me-central-1` deployment is quarantined legacy infrastructure. Frankfurt (`eu-central-1`) is the only active target for the replacement Gate C evidence plane.

## Preserved R0 baseline

The legacy state was pulled read-only and preserved before remediation design:

- AWS account: `094525993248`
- State lineage: `4686e681-5ae2-71f1-7bf3-c959fc387718`
- State serial: `2`
- Backup size: `80452` bytes
- Backup SHA-256: `37a9ac19218f9f8317cb2b84bb7f81a692a3d6e32222ca01fc416cbd69ce206b`

The backup remains private and must never be committed to this public repository.

## Current Gate C decision

Gate C remains **NO-GO**.

The following mandatory acceptance evidence does not yet exist in Frankfurt:

- active immutable evidence bucket;
- active immutable audit bucket;
- Frankfurt KMS key;
- Frankfurt-home CloudTrail trail;
- active Frankfurt GitHub archive role;
- independent verifier policy;
- live WORM receipt;
- independent verification record;
- controlled replay proof with canonical VersionId reuse.

## PR #74 live-gap assessment

At the start of this implementation plan, PR #74 contains only the remediation design document. It has no Frankfurt Terraform root, no Frankfurt-specific validation tests, and no CI coverage proving separation from legacy state.

PR #74 must remain Draft until all implementation-readiness requirements in this document are met.

## Architecture decision

### 1. Legacy plane — frozen ownership

Path:

`infrastructure/evidence-store/aws/`

Status:

- legacy `me-central-1` root;
- existing legacy state remains authoritative;
- no region change;
- no resource address migration;
- no IAM ownership transfer;
- no apply during Gate C remediation;
- no cleanup until Frankfurt Gate C is PASS and a later cleanup change is separately approved.

The remediation PR must not modify this root in a way that would alter runtime behavior or resource ownership.

### 2. Frankfurt active plane — isolated ownership

New path:

`infrastructure/evidence-store/aws-frankfurt/`

This root owns only the replacement Frankfurt evidence plane and Frankfurt-specific IAM role/policies.

It must not own:

- the existing GitHub OIDC provider;
- the legacy `me-central-1` S3 buckets;
- the legacy `me-central-1` KMS key/alias;
- the legacy archive IAM role or inline policy;
- the legacy state object.

### 3. OIDC ownership rule

Reuse the existing account-level GitHub OIDC provider by ARN.

The Frankfurt root must not contain an `aws_iam_openid_connect_provider` resource and must not attempt provider creation. It accepts the existing provider ARN as a required input and validates that it is the GitHub provider for the approved AWS account.

### 4. IAM ownership rule

Create a **new Frankfurt archive role** instead of sharing or modifying the legacy archive role from a second Terraform state.

Recommended role name:

`ros-evidence-archive-euc1-1310606342`

Recommended independent verifier policy name:

`ros-evidence-independent-verifier-euc1-1310606342`

The legacy archive role remains quarantined and receives no permission to Frankfurt resources.

## Target repository structure

```text
infrastructure/evidence-store/
├── aws/                                  # legacy / frozen / me-central-1
│   ├── .terraform.lock.hcl
│   ├── README.md
│   ├── backend.hcl.example
│   ├── main.tf
│   ├── outputs.tf
│   ├── terraform.tfvars.example
│   ├── variables.tf
│   └── versions.tf
│
└── aws-frankfurt/                        # new active Gate C root
    ├── .terraform.lock.hcl
    ├── README.md
    ├── backend.hcl.example
    ├── main.tf
    ├── outputs.tf
    ├── terraform.tfvars.example
    ├── variables.tf
    └── versions.tf

docs/10-engineering/
├── gate-c-frankfurt-region-remediation.md
├── gate-c-frankfurt-implementation-plan.md
└── external-evidence-store-runbook.md    # update active-region instructions
```

Optional static validation may be implemented under the repository's existing scripts/tests structure rather than adding a new standalone toolchain.

## Frankfurt Terraform root requirements

### versions.tf

Required controls:

- Terraform version remains pinned to the repository-approved version;
- AWS provider version remains pinned consistently with repository policy;
- S3 backend remains partial configuration;
- AWS provider `region` resolves only to `eu-central-1`;
- `allowed_account_ids` contains only `094525993248` through the approved account variable;
- default tags retain `ManagedBy=Terraform`, `Project=ROS`, repository identity, and `Control=REL-013`.

The Frankfurt provider must fail closed if configured for any other Region.

### variables.tf

Required variables:

- `aws_region` — default `eu-central-1`, validation must require exact equality;
- `expected_aws_account_id` — validated 12-digit account ID;
- `existing_github_oidc_provider_arn` — required, non-null, exact GitHub OIDC provider ARN shape;
- `evidence_bucket_name` — Frankfurt-specific unique S3 name;
- `audit_bucket_name` — optional explicit Frankfurt audit bucket name;
- `retention_days` — integer, minimum 365;
- repository owner/name/ID/owner-ID;
- trusted branch;
- archive workflow name;
- tags.

The Frankfurt root must have **no** `create_github_oidc_provider` toggle. OIDC creation is out of scope by design.

### backend.hcl.example

Use the existing encrypted backend bucket but a new Frankfurt state key.

Required example key:

`ros/rel-013/evidence-store/eu-central-1/terraform.tfstate`

The backend bucket Region remains the Region where the existing state bucket actually resides. Workload Region and backend storage Region are intentionally independent for this remediation.

Required controls:

- encryption enabled;
- native S3 lockfile enabled;
- approved KMS key placeholder for backend encryption;
- approved account restriction;
- no credentials embedded.

No backend migration is part of R1/R2.

### terraform.tfvars.example

Required safe defaults/placeholders:

- `aws_region = "eu-central-1"`;
- placeholder approved account ID rather than a live secret;
- Frankfurt-specific example bucket names;
- required existing GitHub OIDC provider ARN placeholder;
- `retention_days = 365` or greater;
- no static AWS credentials.

### main.tf — identity and locals

Required locals:

- repository full name;
- trusted ref;
- OIDC subject expected by the repository's active GitHub OIDC subject mode;
- evidence prefix `evidence/github/1310606342`;
- Frankfurt audit bucket name;
- Frankfurt trail name;
- Frankfurt trail ARN;
- account root ARN.

Before final trust-policy review, the implementation must verify the repository's live GitHub OIDC subject customization and ensure the `sub` condition matches it. The trust policy must continue to bind access to the approved repository, branch, repository ID, owner ID, workflow, and audience as supported by AWS/GitHub OIDC claims.

### main.tf — KMS

Create one Frankfurt customer-managed KMS key and one Frankfurt alias.

Recommended alias:

`alias/ros-evidence-euc1-1310606342`

Controls:

- key rotation enabled;
- deletion window configured but Terraform `prevent_destroy = true`;
- account administration retained in key policy;
- CloudTrail may use the key only for the exact Frankfurt trail ARN;
- GitHub archive role receives only the minimum decrypt/data-key permissions required by S3 encryption;
- no KMS administration granted to the GitHub role;
- KMS/S3 usage conditions bind to the approved account, service, and evidence-bucket encryption context.

### main.tf — evidence bucket

Create one Frankfurt evidence bucket.

Recommended naming pattern:

`ros-rel013-evidence-094525993248-eu-central-1`

Required controls:

- `object_lock_enabled = true`;
- `force_destroy = false`;
- Terraform `prevent_destroy = true`;
- versioning enabled;
- Object Lock default retention `COMPLIANCE` and >=365 days;
- SSE-KMS using the Frankfurt KMS key;
- S3 Bucket Key enabled;
- Object Ownership `BucketOwnerEnforced`;
- all four Block Public Access flags enabled;
- deny insecure transport;
- deny TLS below 1.2;
- deny non-KMS uploads;
- deny unexpected KMS key;
- deny non-COMPLIANCE uploads;
- deny uploads without retain-until;
- deny retention below the minimum;
- no lifecycle deletion rule.

### main.tf — audit bucket

Create one separate Frankfurt audit bucket.

Recommended naming pattern:

`ros-rel013-evidence-094525993248-eu-central-1-audit`

Required controls mirror the evidence bucket for:

- Object Lock;
- versioning;
- `COMPLIANCE` retention;
- SSE-KMS;
- Block Public Access;
- TLS requirements;
- Object Ownership;
- `force_destroy = false`;
- `prevent_destroy = true`.

Its bucket policy must additionally permit CloudTrail bucket check and log delivery only for the exact Frankfurt trail ARN and approved account path.

### main.tf — CloudTrail

Create a new trail from the Frankfurt provider so its home Region is `eu-central-1`.

Recommended name:

`ros-evidence-euc1-1310606342`

Required controls:

- multi-Region trail enabled;
- logging enabled;
- log-file validation enabled;
- global service events included;
- management events enabled;
- S3 object data events enabled for the Frankfurt evidence bucket;
- logs delivered to the Frankfurt audit bucket;
- encryption uses the Frankfurt KMS key;
- explicit dependency on audit-bucket policy, Object Lock, and encryption configuration.

### main.tf — Frankfurt archive role

Create a dedicated Frankfurt role using the existing GitHub OIDC provider as federated principal.

Recommended name:

`ros-evidence-archive-euc1-1310606342`

Trust requirements:

- audience `sts.amazonaws.com`;
- approved repository identity;
- approved repository ID `1310606342`;
- approved owner ID `125224479`;
- protected `refs/heads/main`;
- workflow `Archive CI Evidence`;
- exact `sub` format matching the repository's live OIDC subject configuration.

Permission requirements:

- read bucket posture for the Frankfurt evidence bucket;
- append and verify only under `evidence/github/1310606342/*`;
- `PutObjectRetention` only as required by the WORM writer;
- KMS decrypt/generate-data-key only against the Frankfurt key and S3 encryption context;
- no `DeleteObject`;
- no `DeleteObjectVersion`;
- no `BypassGovernanceRetention`;
- no KMS administration;
- no wildcard sensitive writer actions;
- no permissions to legacy `me-central-1` evidence resources.

### main.tf — independent verifier policy

Create one unattached, read-only verifier policy.

Required permissions:

- read Frankfurt evidence/audit bucket posture;
- list the evidence prefix only;
- read exact evidence object versions and retention metadata;
- decrypt/describe using the Frankfurt KMS key for verification;
- read Frankfurt CloudTrail trail/status;
- no writes;
- no delete;
- no retention changes;
- no role assumption expansion inside this policy.

Attach this policy only later to a separately governed reviewer identity through the approved human-access mechanism.

### outputs.tf

Required outputs:

- Frankfurt evidence bucket name;
- Frankfurt audit bucket name;
- Frankfurt KMS key ARN;
- Frankfurt archive role ARN;
- AWS account ID;
- AWS Region;
- evidence prefix;
- independent verifier policy ARN;
- `github_repository_variables` map containing only Frankfurt values.

The outputs must never point to legacy resources.

## Legacy non-interference controls

PR #74 must provide automated proof that the remediation does not alter legacy ownership.

At minimum, CI/static validation must assert:

1. no file under `infrastructure/evidence-store/aws/` changes except an explicitly reviewed documentation-only marker if one is later required;
2. the Frankfurt root has a distinct backend key;
3. the Frankfurt root contains no `aws_iam_openid_connect_provider` resource;
4. the Frankfurt archive role name is distinct from `ros-evidence-archive-1310606342`;
5. Frankfurt bucket names end in or otherwise identify `eu-central-1` and cannot equal legacy names;
6. the Frankfurt KMS alias is distinct from the legacy alias;
7. the Frankfurt CloudTrail name is distinct from any partially attempted legacy trail name;
8. no Frankfurt policy contains the legacy S3 bucket ARNs or legacy KMS ARN;
9. no code path can set the active Frankfurt provider Region to `me-central-1`;
10. no Terraform state command, import block, removed block, or backend migration instruction is introduced by PR #74.

## Required tests

### Terraform static checks

For both roots where applicable:

- `terraform fmt -check`;
- `terraform init -backend=false -lockfile=readonly`;
- `terraform validate`.

PR validation must not contact the live backend and must not create a plan.

### Frankfurt architecture tests

Add repository tests that inspect Terraform source and fail if any invariant is violated.

Required assertions:

- exact active Region is `eu-central-1`;
- OIDC creation resource absent from Frankfurt root;
- existing OIDC ARN required;
- dedicated Frankfurt role name present;
- two Object-Locked buckets present;
- versioning enabled for both;
- `COMPLIANCE` retention >=365;
- `prevent_destroy` on both buckets and KMS key;
- `force_destroy = false` on both buckets;
- SSE-KMS on both buckets;
- all public-access-block controls enabled;
- TLS <1.2 denied;
- evidence uploads require approved KMS and COMPLIANCE retention;
- CloudTrail multi-Region + logging + validation + S3 data events;
- writer has no delete/governance-bypass/KMS-admin permissions;
- verifier policy is read-only;
- Frankfurt state key differs from legacy state key;
- legacy Terraform source remains behaviorally unchanged.

### Negative tests

The test suite must deliberately prove failure for configurations or source mutations equivalent to:

- Region changed from `eu-central-1`;
- OIDC creation enabled/added in Frankfurt root;
- role name collides with legacy role;
- Object Lock changed to GOVERNANCE;
- retention below 365;
- public access block disabled;
- `force_destroy = true`;
- `prevent_destroy` removed;
- writer granted `DeleteObject`, `DeleteObjectVersion`, or `BypassGovernanceRetention`;
- writer granted KMS administration;
- CloudTrail log validation disabled;
- Frankfurt backend key changed to the legacy key;
- Frankfurt policy references a legacy bucket or KMS key.

## CI requirements

PR #74 must extend the existing Terraform evidence validation path or add a dedicated non-mutating job.

Recommended required job name:

`terraform-frankfurt-evidence`

The job must:

1. check out the PR commit;
2. install the repository-pinned Terraform version;
3. run formatting validation for `aws-frankfurt`;
4. run `terraform init -backend=false -lockfile=readonly`;
5. run `terraform validate`;
6. run Frankfurt architecture/static tests;
7. run negative tests;
8. assert legacy root non-interference;
9. upload only non-sensitive test evidence if repository evidence policy requires it.

The CI job must never run `terraform plan`, `apply`, backend initialization, state commands, or AWS mutation.

Existing repository security, CI, operational readiness, and failure-mode checks remain required.

## R1 completion criteria — Draft to Ready

PR #74 may move from Draft to Ready only when all are true:

- [ ] Frankfurt Terraform root added;
- [ ] legacy root runtime behavior unchanged;
- [ ] Frankfurt Region hard-locked to `eu-central-1`;
- [ ] existing OIDC provider reused by required ARN input;
- [ ] no OIDC creation resource in Frankfurt root;
- [ ] dedicated Frankfurt archive role/policy added;
- [ ] Frankfurt evidence bucket added with all WORM controls;
- [ ] Frankfurt audit bucket added with all WORM controls;
- [ ] Frankfurt KMS key/alias added;
- [ ] Frankfurt-home multi-Region CloudTrail added;
- [ ] independent verifier policy added;
- [ ] Frankfurt outputs added;
- [ ] new Frankfurt backend example/key added;
- [ ] Frankfurt tfvars example added;
- [ ] runbook updated to identify Frankfurt as the active Gate C plane;
- [ ] static architecture tests added;
- [ ] negative tests added;
- [ ] `terraform-frankfurt-evidence` or equivalent CI passes;
- [ ] existing required CI/security checks pass;
- [ ] no sensitive state/plan/backend credentials committed;
- [ ] independent code/security review finds no blocking issue.

Moving to Ready is not authorization to produce or apply a Terraform plan.

## R2 — reviewed-code to saved-plan gate

R2 begins only after PR #74 is reviewed, protected checks pass, and the exact remediation code is merged to `main` under normal repository governance.

R2 sequence:

1. verify clean `main` exact commit;
2. verify approved AWS account and existing OIDC provider read-only;
3. initialize only the Frankfurt root against the existing encrypted backend bucket using the new Frankfurt state key;
4. confirm the Frankfurt state is empty/new and does not resolve to the legacy key;
5. produce one saved Frankfurt Terraform plan;
6. do not apply;
7. render and review the saved plan structurally;
8. compute its SHA-256;
9. obtain independent infrastructure/security approval for the exact digest;
10. obtain explicit founder approval for the exact digest;
11. only then may a separate execution step apply the unchanged saved plan.

This document does not authorize any R2 Terraform command now.

## R2 saved-plan structural acceptance

Do not assume a historical resource-count total.

The plan must instead prove:

- zero destroy actions;
- zero replacements;
- zero legacy resource changes;
- zero OIDC provider creation;
- exactly one Frankfurt evidence bucket;
- exactly one Frankfurt audit bucket;
- exactly one Frankfurt KMS key/alias pair;
- exactly one Frankfurt CloudTrail trail;
- exactly one dedicated Frankfurt archive role and its least-privilege policy;
- exactly one independent verifier policy;
- no public exposure;
- no retention downgrade;
- no GOVERNANCE mode;
- no static AWS credentials;
- no delete/governance-bypass writer permissions;
- no unexpected IAM/KMS privilege expansion.

Any violation is NO-GO and requires a new code/plan review cycle.

## Post-apply Gate C acceptance sequence

Even a successful future apply does not close Gate C.

Required sequence after infrastructure creation:

1. independently verify Frankfurt S3/KMS/CloudTrail/IAM posture;
2. verify both buckets are non-public, versioned, Object-Locked, KMS-encrypted, and in Frankfurt;
3. verify CloudTrail home Region is Frankfurt and logging/log-file validation are enabled;
4. verify archive role trust and least privilege;
5. verify independent verifier access separately;
6. set the five `ROS_EVIDENCE_*` GitHub repository variables from Frankfurt outputs only;
7. confirm no long-lived AWS access-key secrets exist for the archive workflow;
8. run/select a successful same-repository subscribed source workflow on clean `main`;
9. allow `Archive CI Evidence` to trigger only through `workflow_run`;
10. capture source SHA/run/attempt, artifact IDs, receipt key, receipt VersionId, artifact VersionIds, KMS key, checksum, and retain-until;
11. independently verify object/version retention as `COMPLIANCE` and effective retention >=365 days;
12. verify exact SHA-256/checksum and KMS binding;
13. verify CloudTrail/audit evidence for the archival activity;
14. rerun the **same archive workflow run**;
15. prove the same canonical receipt VersionId and artifact VersionIds are reused;
16. record independent reviewer decision;
17. only then recommend Gate C PASS / REL-013 closure.

## Risk register

### Blocking

**B1 — Frankfurt implementation absent**

Until code exists and passes non-mutating validation, PR #74 cannot leave Draft.

**B2 — dual-state ownership**

Any attempt to share the legacy IAM role/policy between legacy and Frankfurt states is prohibited.

**B3 — OIDC duplication**

The Frankfurt root must reuse the existing provider; AWS account-level provider duplication for the same GitHub issuer must not be attempted.

**B4 — legacy-state mutation**

Any plan/import/state/backend action against the legacy state during R1 is prohibited.

### High

**H1 — OIDC subject mismatch**

GitHub OIDC subject formats can differ depending on repository customization. The live repository OIDC mode must be verified before the final trust-policy review.

**H2 — WORM irreversibility**

Object Lock COMPLIANCE is intentionally difficult to reverse; names, account, Region, retention, and KMS binding must be correct before any future apply.

**H3 — KMS availability dependency**

WORM evidence encrypted under KMS is only useful while the approved key remains available. `prevent_destroy`, governance, separation of duties, and later operational monitoring remain required.

**H4 — CloudTrail home-Region correctness**

The trail must be created from `eu-central-1`; a multi-Region trail visible in Frankfurt is insufficient if its home Region is elsewhere.

### Medium

**M1 — backend and workload Region differ**

This is intentional for remediation but must be documented to prevent operators from confusing backend Region with evidence Region.

**M2 — duplicate source between legacy and Frankfurt roots**

Temporary Terraform duplication is accepted to avoid legacy resource-address churn. Consolidation is deferred until after Gate C PASS.

**M3 — legacy role remains present**

The legacy role remains quarantined until later cleanup; active GitHub variables must never reference it after Frankfurt cutover.

### Low

**L1 — naming ambiguity**

Use explicit `euc1`/`eu-central-1` names and tags to distinguish active Frankfurt resources from legacy resources.

## Final readiness decision

Current decision remains:

- R0 Preserve State: **PASS**
- R1 Architecture/Design: **CONDITIONAL PASS**
- PR #74 implementation readiness: **NO-GO until the R1 checklist is complete**
- Gate C: **NO-GO until live Frankfurt WORM acceptance and replay proof pass**

The shortest safe path is:

`PR #74 implementation -> non-mutating CI/security review -> merge -> R2 saved-plan + SHA approval -> future exact-plan apply -> independent AWS verification -> GitHub variable cutover -> live WORM receipt -> independent receipt verification -> replay proof -> Gate C PASS`
