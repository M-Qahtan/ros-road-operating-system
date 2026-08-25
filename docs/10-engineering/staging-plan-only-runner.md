# ROS Temporary Cloud Staging — Governed PLAN_ONLY Runner

## Purpose

Generate one saved Terraform plan for the exact reviewed ROS `main` candidate in AWS `me-central-1` using short-lived AWS credentials only, then pass that exact plan through the staging cloud-review verifier.

**Geography boundary:** `me-central-1` is AWS Middle East (UAE). Riyadh, Saudi Arabia is the intended pilot geography, not the AWS hosting region. Any plan produced by this runner must therefore be treated as **temporary UAE cloud staging** and **synthetic/non-sensitive only**. It is not evidence of Saudi hosting or Saudi data residency.

This runbook does **not** authorize Terraform apply, deployment, public-road operation, live partner/government integration, camera ingestion, vehicle actuation, autonomous S3/S4 authority, or use of real incident/evidence/medical/legal data in the temporary UAE staging slice.

## Hard boundaries

- Run only from a clean checkout whose `HEAD` equals the independently approved candidate SHA recorded in the runner manifest.
- Terraform is checked at runtime and must be exactly `1.15.8`; a different version fails closed before AWS planning.
- The disposable IaC workspace is built only from files returned by `git ls-files` under `infrastructure/staging/aws`.
- `infrastructure/staging/aws/region-governance.tf` is part of that tracked-only source set and therefore travels into every governed plan.
- `me-central-1` must be represented as **United Arab Emirates**, never Riyadh/Saudi hosting.
- `pilot_geography` must remain `Riyadh, Saudi Arabia`.
- `saudi_hosted` must remain `false`.
- `staging_data_classification` must remain `SYNTHETIC_NON_SENSITIVE_ONLY`.
- `real_incident_data_allowed` must remain `false`.
- Each geography/data value above is locked by Terraform variable validation; a widening or false hosting claim must fail input validation before a reviewable plan can be produced.
- AWS credentials must be temporary. The runner uses `aws configure export-credentials --format process` and rejects exports without both `SessionToken` and `Expiration`, credentials with less than five minutes remaining, and credentials whose remaining lifetime exceeds the ROS short-lived boundary.
- The exported credentials are kept in memory and passed directly to AWS read calls and Terraform. They are never printed or written by the runner.
- The authenticated AWS Region is fixed to `me-central-1`; the runner performs read-only STS identity and EC2 Region checks before Terraform planning.
- The runner has no `apply`, `destroy`, `import`, state mutation, GitHub OIDC mutation, IAM mutation, repository-variable mutation, or deployment command.
- Terraform runs in a disposable tracked-files-only copy of `infrastructure/staging/aws`; `terraform init` cannot modify the Git checkout.
- The input tfvars file, evidence root, runner manifest, and output directory must all be outside the Git repository and must not be symlinked inputs.
- Runner manifest and tfvars SHA-256 + byte size are checked before and after `terraform plan`; mutation during the run fails closed.
- The saved `ros-staging.tfplan` is sensitive. Keep it only in the approved secure output directory. Never commit it, upload it to ordinary GitHub artifacts, or copy it into the normal WORM evidence package.
- Raw `terraform show -json` output is analyzed in memory and is never written by this runner.
- Existing PLAN_ONLY outputs are never overwritten. A regenerated plan receives a new digest and a new review.

## Required local tools

- Git
- Node/pnpm matching the repository toolchain
- AWS CLI v2 with an already-authenticated short-lived profile/session
- Terraform **exactly `1.15.8`**

No secrets belong in the repository.

## Runner manifest

Create `runner-manifest.json` **outside the repository**:

```json
{
  "schema": "ros-staging-plan-only-runner/v1",
  "expectedCandidateHeadSha": "<exact-approved-main-sha>",
  "claims": {
    "rpoTargetMinutes": 5,
    "rtoTargetMinutes": 30,
    "haApplicationTopologyPlanned": true,
    "managedPostgresPlanned": true,
    "managedRedisPlanned": true,
    "objectEvidenceStorePlanned": true,
    "workerOutboxTopologyPlanned": true,
    "logsMetricsTracesPlanned": true,
    "safetyAlertingPlanned": true,
    "onCallOwnerDefined": true,
    "rollbackTriggerDefined": true,
    "rollbackOwnerDefined": true,
    "shortLivedCloudCredentialsOnly": true,
    "longLivedCloudCredentialsRequested": false,
    "unresolvedP0Findings": 0,
    "unresolvedP1Findings": 0,
    "publicRoadEnabled": false,
    "realPartnerEnabled": false,
    "liveCameraEnabled": false,
    "vehicleActuationEnabled": false,
    "autonomousS3S4Enabled": false
  },
  "evidenceFiles": [
    { "kind": "BACKUP_RESTORE", "path": "backup-restore.json" },
    { "kind": "FAULT_INJECTION", "path": "fault-injection.json" },
    { "kind": "ROLLBACK_PLAN", "path": "rollback-plan.json" },
    { "kind": "OBSERVABILITY", "path": "observability.json" },
    { "kind": "INCIDENT_ONCALL", "path": "incident-oncall.json" },
    { "kind": "SECURITY_POSTURE", "path": "security-posture.json" }
  ]
}
```

The manifest values are claims, not self-proving facts. Never change a claim merely to obtain a green package. The hosting/data boundary is additionally enforced in Terraform and cannot be widened through this manifest.

Every evidence file is independently byte-sized and SHA-256 hashed by the runner, then re-read and verified by `verifyStagingCloudPackage`.

## Required Terraform hosting/data inputs

The external tfvars must preserve the explicit governance values:

```hcl
aws_region                    = "me-central-1"
pilot_geography               = "Riyadh, Saudi Arabia"
cloud_jurisdiction             = "United Arab Emirates"
saudi_hosted                   = false
staging_data_classification    = "SYNTHETIC_NON_SENSITIVE_ONLY"
real_incident_data_allowed     = false
```

Any attempt to set `saudi_hosted=true`, widen the data classification, enable real incident data, relabel `me-central-1` as Saudi Arabia, or change the pilot geography without a separately governed change fails closed through Terraform variable validation.

## Observability and trace-correlation evidence basis

`logsMetricsTracesPlanned=true` does **not** claim that ROS has deployed AWS X-Ray, a third-party APM backend, or a full OpenTelemetry collector. It refers to the existing vendor-neutral trace-correlation plane represented in the application/runtime design and the merged staging logging/metrics topology.

The `OBSERVABILITY` evidence file for a real PLAN_ONLY review should cite the exact reviewed Git SHA and relevant runtime/source paths, plus the staging CloudWatch/Container Insights resources. Any future sampled span storage, service maps, OpenTelemetry export, X-Ray or another backend is a separate capability and permission review.

## Sensitive Terraform inputs

Create the reviewed `.tfvars` or `.tfvars.json` file outside the repository. It may contain environment-specific trust material and therefore must not be committed.

The exact required variables are defined by `infrastructure/staging/aws/*.tf`. The runner refuses a tfvars file located inside the repository. Its SHA-256 is emitted only as a digest in the sanitized terminal result and is checked again after plan generation; the file contents are never printed by the runner.

## Secure output directory

Create an empty directory outside the repository. It must not contain any of these names before the run:

- `ros-staging.tfplan`
- `ros-staging.tfplan.sha256`
- `ros-staging-cloud-review.json`
- `ros-staging-cloud-decision.json`

The runner refuses to overwrite an earlier plan or decision.

## Execution

From the exact repository root:

```bash
pnpm --filter @ros/api plan:staging-review -- \
  <runner-manifest.json> \
  <evidence-root> \
  <tfvars-file> \
  <secure-output-dir> \
  [aws-profile]
```

The same command is usable from PowerShell with normal PowerShell line-continuation/path syntax.

## Operations performed

The runner performs only:

1. exact Git HEAD + clean working-tree proof;
2. exact Terraform `1.15.8` version proof;
3. tracked-files-only staging IaC materialization, including the region-governance variables;
4. manifest/tfvars pre-run SHA-256 capture;
5. temporary AWS credential export and expiry validation;
6. `sts:GetCallerIdentity` read;
7. `ec2:DescribeRegions` read for `me-central-1` (Middle East/UAE);
8. isolated `terraform init -backend=false -input=false -lockfile=readonly`;
9. `terraform plan -input=false -out=<secure-plan> -var-file=<external-tfvars>`;
10. manifest/tfvars post-plan SHA-256 equality proof;
11. in-memory `terraform show -json` through the governance verifier;
12. evidence byte/hash verification;
13. sanitized review package, decision JSON and plan SHA-256 output.

No captured Terraform init/plan stdout or stderr is emitted by the runner because plan/input data can be sensitive.

## Exit semantics

- exit `0`: `STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW` only;
- exit `2`: the plan/package was validly analyzed but one or more governance blockers remain (`NO_GO`);
- exit `1`: malformed input, missing tool/session, credential/Region failure, Git mismatch, integrity failure, Terraform failure, region/data-governance failure, or runner execution error.

A status of `STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW` still contains:

- `terraformApplyAuthorized=false`
- `deploymentAuthorized=false`
- `publicRoadAuthorized=false`
- `externalIntegrationAuthorized=false`

It is a review gate only. It is **not** an apply authorization, a Saudi-hosting claim, or permission to process real operational data.
