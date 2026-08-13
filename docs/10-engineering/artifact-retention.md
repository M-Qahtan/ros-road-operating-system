# Artifact retention

The founder approved a public source repository plus a separate immutable evidence store for REL-013. GitHub Actions artifacts are a 90-day transport cache only. They are not the authoritative archive and their platform expiration does not satisfy the 365-day requirement.

Every required CI, security, recovery, staging, pilot, and release artifact must remain bound to candidate head SHA, candidate base SHA, tested merge SHA, workflow/job, run ID, and run attempt. After a subscribed workflow completes, `.github/workflows/archive-ci-evidence.yml` runs from trusted `main`, downloads same-repository artifacts as opaque bytes, and appends them to the approved S3 store.

The authoritative archive requires:

- S3 Object Lock `COMPLIANCE` with effective retention of at least 365 days;
- versioning and a recorded object `VersionId`;
- customer-managed KMS encryption and SHA-256 checksum verification;
- no public access and TLS 1.2 or later;
- GitHub OIDC with no long-lived AWS credentials;
- an append-only role with no delete, retention shortening, or bypass permissions; its only retention mutation is `s3:PutObjectRetention` to set or extend `COMPLIANCE` retention on evidence it can write;
- a WORM receipt binding source SHA/run/artifact IDs to digest, object key, version, KMS key, and retain-until time;
- CloudTrail data-event audit logs in a separate immutable bucket.

`scripts/verify-artifact-retention.mjs` verifies the repository configuration, while `scripts/archive-github-evidence.mjs` verifies live bucket posture and each uploaded object. Neither configuration alone closes REL-013. Closure requires one successful live archive receipt and independent AWS verification under the [external evidence runbook](external-evidence-store-runbook.md). Legal holds may extend protection but never shorten it.
