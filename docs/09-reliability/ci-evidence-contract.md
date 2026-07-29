# CI and release evidence contract

Every release-relevant artifact must identify:

- `candidate_head_sha` — the source revision proposed by the pull request;
- `candidate_base_sha` — the reviewed base revision;
- `tested_merge_sha` — the merge revision actually executed by GitHub Actions;
- workflow, job, event, ref, run ID, and run attempt.

## Fail-closed rules

An artifact is invalid when it is missing, empty, malformed, associated with another SHA, produced by a stale run, or uploaded after its validation step failed. Required jobs use `if-no-files-found: error` and validate manifests before upload.

The operational readiness decision may rely only on upstream jobs whose GitHub result is exactly `success`. `failure`, `cancelled`, `skipped`, missing, or stale results block release.

Security, PostgreSQL restore, staging fault injection, Riyadh E2E, failure-mode safety, and the final readiness decision retain evidence for at least 90 days; the final release decision is retained for 365 days.
