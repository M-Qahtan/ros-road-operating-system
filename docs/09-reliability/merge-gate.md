# Merge and release gate

## Protected branch contract

`main` accepts changes only through a pull request. Required checks must be produced by GitHub Actions, associated with the current candidate, and complete successfully. Force pushes, branch deletion, routine bypass, and merging with unresolved material findings are prohibited.

## Current foundation checks

- `verify`
- `terraform-evidence`
- `postgres-integration`
- `staging-smoke`
- `riyadh-e2e`
- `dependency-review`
- `repository-security`
- `riyadh-failure-modes`
- `operational-readiness`

All nine checks are canonical and must be present in the active `main` ruleset. A documented check name without matching live ruleset enforcement is not sufficient.

## Blocking semantics

A required check blocks merge or release when it is missing, stale, pending beyond the approved timeout, skipped, cancelled, neutral where success is required, or failed. A similarly named check from an unapproved source is not acceptable.

## Emergency change

Emergency bypass is permitted only when delay creates a greater immediate safety risk. It requires explicit founder or delegated Incident Commander authorization, a documented incident, exact commit SHA, rollback plan, post-merge execution of every gate, and immediate rollback when any required check fails.

Delivery pressure, convenience, dependency update urgency, or schedule commitments are not emergency justification.
