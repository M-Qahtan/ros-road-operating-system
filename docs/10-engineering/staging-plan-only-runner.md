# ROS Riyadh Staging — Governed PLAN_ONLY Runner

## Purpose

Generate one saved Terraform plan for the exact reviewed ROS `main` candidate in Riyadh (`me-central-1`) using short-lived AWS credentials only, then pass that exact plan through the existing `ros-staging-cloud-review/v1` verifier.

This runbook does **not** authorize Terraform apply, deployment, public-road operation, live partner/government integration, camera ingestion, vehicle actuation, or autonomous S3/S4 authority.

## Hard boundaries

- Run only from a clean checkout whose `HEAD` equals the independently approved candidate SHA recorded in the runner manifest.
- Terraform is checked at runtime and must be exactly `1.15.8`; a different version fails closed before AWS planning.
- The disposable IaC workspace is built only from files returned by `git ls-files` under `infrastructure/staging/aws`. Ignored/untracked `.terraform`, state, tfvars, plan or other local artifacts cannot enter the planning source tree.
- AWS credentials must be temporary. The runner uses `aws configure export-credentials --format process` and rejects exports without both `SessionToken` and `Expiration`, credentials with less than five minutes remaining, and credentials whose remaining lifetime exceeds the ROS short-lived boundary.
- The exported credentials are kept in memory and passed directly to AWS read calls and Terraform. They are never printed or written by the runner.
- The authenticated AWS Region is fixed to `me-central-1`; the runner performs read-only STS identity and EC2 Region checks before Terraform planning.
- The runner has no `apply`, `destroy`, `import`, state mutation, GitHub OIDC mutation, IAM mutation, repository-variable mutation, or deployment command.
- Terraform runs in a disposable tracked-files-only copy of `infrastructure/staging/aws`; `terraform init` cannot modify the Git checkout.
- The input tfvars file, evidence root, runner manifest, and output directory must all be outside the Git repository and must not be symlinked inputs.
- Runner manifest and tfvars SHA-256 + byte size are checked before and after `terraform plan`; mutation during the run fails closed.
- The saved `ros-staging.tfplan` is sensitive. Keep it only in the approved secure output directory. Never commit it, upload it to ordinary GitHub artifacts, or copy it into the normal WORM evidence package.
- Raw `terraform show -json` output is analyzed in memory by the existing verifier and is never written by this runner.
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

The manifest values are claims, not self-proving facts. Set `unresolvedP0Findings` or `unresolvedP1Findings` above zero whenever the exact review still has an open finding. Never change a claim merely to obtain a green package.

Every evidence file is independently byte-sized and SHA-256 hashed by the runner, then re-read and verified by `verifyStagingCloudPackage`.

## Observability and trace-correlation evidence basis

`logsMetricsTracesPlanned=true` does **not** claim that ROS has deployed AWS X-Ray, a third-party APM backend, or a full OpenTelemetry collector. It refers to the existing vendor-neutral trace-correlation plane that is already represented in the application/runtime design and the merged staging logging/metrics topology:

- `apps/api/src/request-security.ts` validates or generates a bounded request `traceId`;
- `apps/api/src/main.ts` returns that trace ID to the caller and wraps the RoadEvent HTTP operation in `withTraceBoundary`;
- `apps/api/src/runtime/telemetry.ts` emits structured `operation.started`, `operation.completed`, and `operation.failed` records containing the trace ID and duration/error context;
- `apps/api/src/application/road-event-application.ts` requires `CommandContext.traceId` and binds it into RoadEvent repository mutations;
- `apps/api/src/messaging/outbox-types.ts` includes `traceId` in the durable integration-message contract;
- `apps/api/src/messaging/postgres-outbox-repository.ts` rehydrates `trace_id` from PostgreSQL into the claimed Outbox message;
- `apps/api/src/messaging/redis-stream-broker.ts` propagates `traceId` into the Redis Stream event fields;
- the merged staging IaC captures application/worker stdout into encrypted CloudWatch Log Groups and enables Container Insights/metrics and alarms.

This is a distributed **trace-correlation** design across HTTP → application → durable outbox → worker/broker boundaries. It is sufficient for the governance claim that logs, metrics and traces are planned and represented without adding a new AWS permission or external observability service. It must not be overstated as a full span-storage/APM visualization backend.

The `OBSERVABILITY` evidence file for a real PLAN_ONLY review should cite the exact reviewed Git SHA and these source/runtime paths, plus the staging CloudWatch/Container Insights resources. If future requirements demand sampled span storage, service maps, OpenTelemetry export, X-Ray or another backend, that is a separate capability and permission review rather than a hidden assumption in this claim.

## Sensitive Terraform inputs

Create the reviewed `.tfvars` or `.tfvars.json` file outside the repository. It may contain environment-specific trust material and therefore must not be committed.

The exact required variables are defined by `infrastructure/staging/aws/variables.tf`. The runner refuses a tfvars file located inside the repository. Its SHA-256 is emitted only as a digest in the sanitized terminal result and is checked again after plan generation; the file contents are never printed by the runner.

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
3. tracked-files-only staging IaC materialization;
4. manifest/tfvars pre-run SHA-256 capture;
5. temporary AWS credential export and expiry validation;
6. `sts:GetCallerIdentity` read;
7. `ec2:DescribeRegions` read for `me-central-1`;
8. isolated `terraform init -backend=false -input=false -lockfile=readonly`;
9. `terraform plan -input=false -out=<secure-plan> -var-file=<external-tfvars>`;
10. manifest/tfvars post-plan SHA-256 equality proof;
11. in-memory `terraform show -json` through the existing governance verifier;
12. evidence byte/hash verification;
13. sanitized review package, decision JSON and plan SHA-256 output.

No captured Terraform init/plan stdout or stderr is emitted by the runner because plan/input data can be sensitive.

The sanitized terminal result includes only review-safe binding metadata such as Terraform version, tracked IaC file count, manifest SHA-256, tfvars SHA-256, plan SHA-256, sanitized account reference and plan action analysis. It does not print credentials, tfvars contents or raw Terraform JSON.

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
