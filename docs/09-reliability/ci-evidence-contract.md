# CI and release evidence contract

Every release-relevant artifact must identify:

- `candidate_head_sha` — the source revision proposed by the pull request;
- `candidate_base_sha` — the reviewed base revision;
- `tested_merge_sha` — the merge revision actually executed by GitHub Actions;
- workflow, job, event, ref, run ID, run attempt, and a validated `retention_days` value of at least 365.

## Fail-closed rules

An artifact is invalid when it is missing, empty, malformed, associated with another SHA, produced by a stale run, or uploaded after its validation step failed. Required jobs use `if-no-files-found: error` and validate manifests before upload.

The operational readiness decision may rely only on upstream jobs whose GitHub result is exactly `success`. `failure`, `cancelled`, `skipped`, missing, or stale results block release.

Every required verification, security, PostgreSQL, staging, Riyadh, failure-mode, pilot, and release artifact requires at least 365 days of effective retention in the approved external WORM store. Public GitHub artifacts are retained for 90 days only as a transport cache.

The CI workflow validates the external evidence Terraform with a pinned Terraform version by running formatting checks, `init -backend=false`, and `validate`. This proves provider-backed configuration validity without reading the production backend or creating AWS resources; plan review and live apply remain separate acceptance steps.

The privileged archive workflow must execute trusted `main`, reject fork provenance, treat source ZIPs as opaque data, use short-lived GitHub OIDC credentials, and verify S3 versioning, non-public posture, KMS key, SHA-256, `COMPLIANCE` mode, non-empty `VersionId`, and an effective retain-until interval of at least 365 days. The archive receipt follows `ros-external-evidence/v1` and is itself locked and encrypted.

A requested retention value, Terraform configuration, GitHub upload, or successful source job alone is not retention evidence. A release decision is invalid until its external receipt key and exact S3 version ID are recorded and independently verified.
