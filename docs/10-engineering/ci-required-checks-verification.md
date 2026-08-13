# CI required-check verification record

Issue: #19

## Configuration reviewed

`CI` runs on pull requests and pushes to `main`. The current required CI jobs are `verify`, `terraform-evidence`, `postgres-integration`, `staging-smoke`, and `riyadh-e2e`. Security adds `dependency-review` and `repository-security`; the safety and release workflows add `riyadh-failure-modes` and `operational-readiness`.

## Evidence identity

Each CI artifact records and validates:

- candidate head SHA;
- candidate base SHA;
- tested merge SHA;
- workflow event, ref, run ID, and run attempt.

Artifact upload is fail-closed: required files are checked before upload and `if-no-files-found` is `error`.

## Completion evidence required before closing #19

- all nine protected checks succeed on the current PR head and tested merge revision;
- each CI evidence artifact passes the repository validator;
- the `main` ruleset is active and targets the canonical checks from `required-checks.txt`;
- a deliberately failing candidate is demonstrably blocked from merging;
- no required check is missing, skipped, cancelled, stale, or associated only with another revision.
