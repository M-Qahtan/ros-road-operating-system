# CI required-check verification record

Issue: #19

## Configuration reviewed

The repository CI workflow is configured for both `pull_request` events and pushes to `main`.

The required jobs are:

- `verify`
- `postgres-integration`
- `staging-smoke`
- `riyadh-e2e`

## Change evidence

This branch adds per-job evidence manifests and commit-addressed artifact names. Each artifact name includes the pull-request head commit SHA, workflow run ID, and run attempt.

## Repository administrator action

After this pull request is validated, configure the `main` ruleset using `main-branch-protection.md`. Ruleset configuration is a repository setting and is intentionally not represented as application source code.

## Completion evidence required before closing #19

- Link to a pull-request workflow run showing all four jobs.
- Confirmation that a deliberately failing required check blocks merge.
- Confirmation that all four evidence artifacts contain manifests matching the PR head SHA.
- Confirmation that the `main` ruleset requires review and the four named checks.

Until those items are recorded, absence of required-check evidence remains a release blocker.
