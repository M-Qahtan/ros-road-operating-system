# ROS external immutable evidence store runbook

## Purpose and authority boundary

This runbook governs Gate C / REL-013 for the public ROS repository. The **active evidence target is Frankfurt (`eu-central-1`)**. The previously partially applied `me-central-1` stack is quarantined legacy infrastructure and is not an active archive destination.

This runbook does not authorize production deployment, public-road operation, real emergency/government integration, camera access, vehicle actuation, or a later work package.

REL-013 closes only after the live Frankfurt acceptance checks in this runbook pass. Source review, Terraform validation, a saved plan, or a requested retention value is not sufficient evidence.

## Region-remediation boundary

The legacy Terraform root remains at:

`infrastructure/evidence-store/aws/`

It owns the preserved `me-central-1` partial deployment and must not be used for Frankfurt provisioning, region changes, state migration, or IAM ownership transfer during Gate C remediation.

The active Frankfurt root is:

`infrastructure/evidence-store/aws-frankfurt/`

It uses a separate state key:

`ros/rel-013/evidence-store/eu-central-1/terraform.tfstate`

The existing encrypted backend bucket may remain in `me-central-1`; backend storage Region and workload Region are independent. Backend relocation is a separate governance change.

## Approved active architecture

| Control | Frankfurt implementation |
| --- | --- |
| Primary evidence | Amazon S3 in `eu-central-1` |
| Audit evidence | Separate S3 audit bucket in `eu-central-1` |
| Immutability | S3 Object Lock `COMPLIANCE`; bucket default >=365 days; each archive upload explicitly requests >=366 days |
| Version identity | S3 `VersionId` recorded for every artifact and receipt |
| Encryption | Frankfurt customer-managed AWS KMS key with rotation enabled and S3 Bucket Keys |
| Public exposure | All four S3 public-access controls enabled; bucket policy/status must be non-public |
| Transport | TLS required; versions below TLS 1.2 denied |
| Workload identity | Existing account-level GitHub OIDC provider reused by ARN; no long-lived AWS access keys |
| IAM ownership | Distinct Frankfurt archive role; legacy archive role is not shared or modified by Frankfurt state |
| Least privilege | GitHub role can append/verify only under `evidence/github/1310606342/*`; no delete, governance bypass, or KMS administration |
| Provenance | Repository ID, source SHA, workflow/run/attempt, artifact ID, SHA-256, KMS key, object key, and VersionId |
| Replay safety | Same archive run/attempt and same content must reuse the already verified immutable artifact and receipt versions |
| Audit | Frankfurt-home multi-Region CloudTrail, log-file validation, management events, and evidence S3 object data events |
| Terraform safety | Evidence bucket, audit bucket, and KMS key use `prevent_destroy`; S3 `force_destroy=false` |

The privileged workflow remains `Archive CI Evidence`, triggered only through successful same-repository `workflow_run` events. It downloads source artifacts as opaque ZIP bytes and never extracts or executes pull-request content.

No lifecycle deletion rule is configured. Object Lock protects versions for the retention period; reaching the minimum retention date does not itself authorize deletion.

## R0 preserved baseline

Before remediation, the legacy remote state was pulled read-only and backed up privately:

- lineage: `4686e681-5ae2-71f1-7bf3-c959fc387718`
- serial: `2`
- backup size: `80452` bytes
- SHA-256: `37a9ac19218f9f8317cb2b84bb7f81a692a3d6e32222ca01fc416cbd69ce206b`

The backup must remain outside the public repository.

## 1. Pull-request implementation validation

PR validation for the Frankfurt root is intentionally non-mutating. The dedicated `terraform-frankfurt-evidence` job performs only:

- static architecture checks;
- negative fail-closed checks;
- legacy-root non-interference proof;
- `terraform fmt -check`;
- `terraform init -backend=false -lockfile=readonly`;
- `terraform validate`.

The workflow has read-only repository permissions and no AWS credentials or OIDC token permission. It must not initialize the live backend, create a plan, or mutate AWS.

PR #74 stays Draft until the Frankfurt root, tests, documentation, and required CI/security review are complete.

## 2. R2 saved-plan gate — after reviewed merge only

Only after the implementation PR is independently reviewed, protected checks pass, and the exact code is merged to clean `main`, R2 may initialize the Frankfurt root against the existing encrypted backend using the **new Frankfurt state key**.

Create a private backend HCL from `infrastructure/evidence-store/aws-frankfurt/backend.hcl.example`. It must point to the existing approved backend bucket/KMS configuration while using:

`ros/rel-013/evidence-store/eu-central-1/terraform.tfstate`

Required pre-plan checks:

- AWS caller account matches the approved account;
- workload Region is exactly `eu-central-1`;
- Frankfurt state key is new/isolated;
- existing GitHub OIDC provider ARN is the exact provider in the approved account;
- legacy state and legacy root remain unchanged.

Then, and only under the separately released R2 plan phase, create a saved Frankfurt plan and SHA-256. The plan is reviewed structurally; the historical `22/0/0` count is no longer an acceptance criterion.

Reject any plan containing:

- destroy or replacement of legacy resources;
- mutation of the legacy state;
- OIDC provider creation;
- legacy IAM role ownership or modification;
- Region other than `eu-central-1` for active resources;
- public exposure;
- Object Lock `GOVERNANCE` mode;
- retention below 365 days;
- `force_destroy=true`;
- missing `prevent_destroy` on protected resources;
- delete, retention-bypass, KMS-admin, or wildcard sensitive writer permissions;
- static AWS credentials.

Record the exact saved-plan SHA-256. Do not apply until both the infrastructure/security reviewer and founder explicitly approve that exact digest.

The prior `me-central-1` saved plan and SHA are superseded and must never be reused.

## 3. Future exact-plan apply gate

When a later approval explicitly authorizes apply, recompute the saved-plan SHA-256 immediately before execution and fail closed on any mismatch. Apply only the unchanged reviewed saved plan.

A successful apply does **not** close Gate C.

## 4. Independently verify Frankfurt infrastructure

Before configuring GitHub repository variables, independently verify the Frankfurt stack:

- both evidence and audit buckets are physically in `eu-central-1`;
- Versioning is `Enabled` on both;
- Object Lock is `Enabled` on both;
- default retention is `COMPLIANCE` and >=365 days;
- SSE-KMS uses the approved Frankfurt KMS key;
- S3 Bucket Keys are enabled;
- all public-access-block flags are true;
- bucket policy status is non-public;
- TLS below 1.2 is denied;
- evidence policy rejects non-KMS, unexpected-key, non-COMPLIANCE, missing-retain-until, and too-short retention writes;
- KMS key rotation is enabled and deletion remains operationally prohibited;
- Frankfurt archive role trust is restricted to repository `M-Qahtan/ros-road-operating-system`, repository ID `1310606342`, owner ID `125224479`, `refs/heads/main`, workflow `Archive CI Evidence`, and audience `sts.amazonaws.com`;
- the role has no delete, governance-bypass, or KMS-admin rights;
- CloudTrail home Region is Frankfurt, logging is active, multi-Region is enabled, log validation is enabled, and evidence S3 object data events are selected;
- the independent verifier policy is read-only and not attached by the infrastructure root.

Do not configure GitHub evidence variables until this verification passes.

## 5. Configure GitHub repository variables to Frankfurt

After independent Frankfurt infrastructure verification, configure only these non-secret identifiers from Frankfurt outputs:

- `ROS_EVIDENCE_AWS_ACCOUNT_ID`
- `ROS_EVIDENCE_AWS_REGION` = `eu-central-1`
- `ROS_EVIDENCE_AWS_ROLE_ARN` = Frankfurt archive role
- `ROS_EVIDENCE_BUCKET` = Frankfurt evidence bucket
- `ROS_EVIDENCE_KMS_KEY_ARN` = Frankfurt KMS key

Do not create `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` repository secrets. GitHub must obtain short-lived credentials through OIDC.

The legacy role, legacy bucket, and legacy KMS key must never be used as active values.

## 6. Run the first live proof

Produce or select a successful subscribed same-repository source workflow run on protected `main`. `ROS Eye Pilot Readiness` remains a preferred controlled source workflow.

Do not dispatch `Archive CI Evidence` directly. The privileged archive workflow must start only through its `workflow_run` subscription after the source workflow concludes successfully.

Record:

- source workflow URL;
- source run ID and attempt;
- source SHA;
- archive workflow URL;
- artifact IDs;
- artifact SHA-256 values;
- artifact S3 object keys and VersionIds;
- receipt key and VersionId;
- KMS key ARN;
- retain-until timestamp.

## 7. Independently verify the WORM receipt and artifacts

Using a separately governed read-only reviewer identity, verify each exact S3 version:

- non-empty VersionId;
- checksum/SHA-256 matches the GitHub artifact bytes and receipt;
- `ServerSideEncryption=aws:kms`;
- exact Frankfurt KMS key;
- `ObjectLockMode=COMPLIANCE`;
- effective retain-until minus LastModified >=365 days;
- object metadata/provenance matches source run/attempt/SHA/artifact identity;
- evidence bucket remains non-public and correctly locked;
- CloudTrail remains logging to the immutable audit bucket.

The receipt is evidence only if all referenced artifact versions pass independently.

## 8. Controlled replay-idempotency proof

Rerun the **same archive workflow run** after its first success. Do not create a different source run for this proof.

The rerun must:

- report reuse of the verified immutable artifact versions;
- reuse the same canonical receipt VersionId;
- preserve the same artifact VersionIds recorded by the receipt;
- fail closed on any checksum, metadata, KMS, retention, or receipt-content mismatch.

Creating new WORM versions for identical source evidence fails this hardening check.

## Gate C live acceptance record

All items are mandatory:

- [ ] R0 preserved legacy state remains unchanged.
- [ ] Frankfurt implementation PR was independently reviewed and protected CI/security checks passed.
- [ ] R2 saved plan was reviewed and its exact SHA-256 explicitly approved before apply.
- [ ] Active evidence and audit buckets are in `eu-central-1`.
- [ ] Evidence and audit buckets have Versioning and Object Lock enabled.
- [ ] Default retention is `COMPLIANCE` and >=365 days.
- [ ] Evidence objects and receipt are exact immutable versions with non-empty VersionIds.
- [ ] `head-object`/equivalent proof reports approved KMS and exact checksum.
- [ ] Public access is blocked and policy status is non-public.
- [ ] GitHub authenticates through the reused OIDC provider only; no static AWS keys exist.
- [ ] Frankfurt writer role is append/verify only and cannot delete or bypass retention.
- [ ] Frankfurt CloudTrail is logging, multi-Region, validates logs, and records evidence S3 data events.
- [ ] Separate audit bucket is WORM-protected.
- [ ] Independent reviewer records source run, archive run, receipt key/VersionId, and decision.
- [ ] Controlled rerun reuses the same canonical receipt VersionId and artifact VersionIds.

Only after every item passes may Gate C be declared **PASS** and REL-013 be recommended for closure. WP-00 closure remains a separate overall decision.

## Failure and recovery

Fail closed on any of the following:

- wrong AWS account or active Region;
- wrong/new OIDC provider;
- missing GitHub variables or failed OIDC assumption;
- empty artifact set, fork run, or non-success source workflow;
- wrong repository ID or protected-branch identity;
- public bucket or weakened public-access block;
- Object Lock `GOVERNANCE` mode;
- retention below 365 days;
- wrong KMS key or missing KMS binding;
- missing VersionId or checksum mismatch;
- inactive/unverified CloudTrail;
- replay creating new canonical versions for identical source evidence;
- any request to mutate the preserved legacy state as part of Frankfurt remediation.

Legacy cleanup, legacy IAM retirement, backend relocation, and state consolidation are explicitly deferred until after Frankfurt Gate C is PASS and require a separate reviewed governance change.
