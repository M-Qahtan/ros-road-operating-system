# ROS Riyadh Staging — Governed PLAN_ONLY Runner

## Purpose

Generate one saved Terraform plan for the exact reviewed ROS `main` candidate in Riyadh (`me-central-1`) using short-lived AWS credentials only, then pass that exact plan through the existing `ros-staging-cloud-review/v1` verifier.

This runbook does **not** authorize Terraform apply, deployment, public-road operation, live partner/government integration, camera ingestion, vehicle actuation, or autonomous S3/S4 authority.

## Hard boundaries

- Run only from a clean checkout whose `HEAD` equals the independently approved candidate SHA recorded in the runner manifest.
- AWS credentials must be temporary. The runner uses `aws configure export-credentials --format process` and rejects exports without both `SessionToken` and `Expiration`, credentials with less than five minutes remaining, and credentials whose remaining lifetime exceeds the ROS short-lived boundary.
- The exported credentials are kept in memory and passed directly to AWS read calls and Terraform. They are never printed or written by the runner.
- The authenticated AWS Region is fixed to `me-central-1`; the runner performs read-only STS identity and EC2 Region checks before Terraform planning.
- The runner has no `apply`, `destroy`, `import`, state mutation, GitHub OIDC mutation, IAM mutation, repository-variable mutation, or deployment command.
- Terraform runs in a disposable copy of `infrastructure/staging/aws`; `terraform init` cannot modify the Git checkout.
- The input tfvars file, evidence root, runner manifest, and output directory must all be outside the Git repository.
- The saved `ros-staging.tfplan` is sensitive. Keep it only in the approved secure output directory. Never commit it, upload it to ordinary GitHub artifacts, or copy it into the normal WORM evidence package.
- Raw `terraform show -json` output is analyzed in memory by the existing verifier and is never written by this runner.
- Existing PLAN_ONLY outputs are never overwritten. A regenerated plan receives a new digest and a new review.

## Required local tools

- Git
- Node/pnpm matching the repository toolchain
- AWS CLI v2 with an already-authenticated short-lived profile/session
- Terraform `1.15.8`

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
    "logsMetricsTracesPlanned": false,
    "safetyAlertingPlanned": true,
    "onCallOwnerDefined": true,
    "rollbackTriggerDefined": true,
    "rollbackOwnerDefined": true,
    "shortLivedCloudCredentialsOnly": true,
    "longLivedCloudCredentialsRequested": false,
    "unresolvedP0Findings": 0,
    "unresolvedP1Findings": 1,
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

The values above intentionally show the current observability gap honestly: the merged staging IaC contains logs, metrics and alarms, but no proven distributed-tracing plane. Therefore `logsMetricsTracesPlanned=false` and the unresolved P1 remains nonzero until a separately reviewed tracing decision closes it. Do **not** change either field merely to obtain a green package.

Every evidence file is independently byte-sized and SHA-256 hashed by the runner, then re-read and verified by `verifyStagingCloudPackage`.

## Sensitive Terraform inputs

Create the reviewed `.tfvars` or `.tfvars.json` file outside the repository. It may contain environment-specific trust material and therefore must not be committed.

The exact required variables are defined by `infrastructure/staging/aws/variables.tf`. The runner refuses a tfvars file located inside the repository.

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
2. temporary AWS credential export and expiry validation;
3. `sts:GetCallerIdentity` read;
4. `ec2:DescribeRegions` read for `me-central-1`;
5. isolated `terraform init -backend=false -input=false -lockfile=readonly`;
6. `terraform plan -input=false -out=<secure-plan> -var-file=<external-tfvars>`;
7. in-memory `terraform show -json` through the existing governance verifier;
8. evidence byte/hash verification;
9. sanitized review package, decision JSON and plan SHA-256 output.

No captured Terraform init/plan stdout or stderr is emitted by the runner because plan/input data can be sensitive.

## Exit semantics

- exit `0`: `STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW` only;
- exit `2`: the plan/package was validly analyzed but one or more governance blockers remain (`NO_GO`);
- exit `1`: malformed input, missing tool/session, credential/Region failure, Git mismatch, integrity failure, Terraform failure, or runner execution error.

A status of `STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW` still contains:

- `terraformApplyAuthorized=false`
- `deploymentAuthorized=false`
- `publicRoadAuthorized=false`
- `externalIntegrationAuthorized=false`

It is a review gate, not an apply authorization.

## Current known P1 before the first real run

The merged staging topology currently provides CloudWatch logs, Container Insights/metrics and alarms, but no proven tracing plane. The governance contract requires `logsMetricsTracesPlanned=true` for founder-review readiness. Until that mismatch is resolved by a separately reviewed engineering decision, the correct real PLAN_ONLY outcome is expected to remain `NO_GO` rather than falsifying the claim.
