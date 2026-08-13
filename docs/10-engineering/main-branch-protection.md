# Main branch protection and required CI evidence

This document defines the minimum merge controls for `main` in the ROS repository. These controls are release gates for a safety-relevant system and must not be weakened for convenience.

## Required workflow triggers

The `CI`, `Security`, `Riyadh Failure-Mode Safety`, and `Operational Readiness` workflows must run on every pull request and every push to `main`.

## Required checks

The `main` ruleset requires these GitHub Actions checks:

1. `verify`
2. `terraform-evidence`
3. `postgres-integration`
4. `staging-smoke`
5. `riyadh-e2e`
6. `dependency-review`
7. `repository-security`
8. `riyadh-failure-modes`
9. `operational-readiness`

A missing, skipped, cancelled, stale, or failed required check blocks merge.

## Required pull-request controls

- pull requests are required before merging;
- required checks must pass and the branch must be current with `main`;
- conversations must be resolved before merge;
- force pushes and branch deletion are blocked;
- no routine bypass is permitted;
- review approval is required when an independent eligible reviewer is configured.

## Traceable CI evidence

Every required CI job emits a manifest with:

- `candidate_head_sha`: the exact proposed source revision;
- `candidate_base_sha`: the exact base revision used for the candidate;
- `tested_merge_sha`: the exact revision GitHub Actions executed;
- workflow, event, ref, run ID, and run attempt.

The source workflow validates every manifest before upload and retains the GitHub artifact for 90 days as a transport cache. The separate `Archive CI Evidence` workflow runs from trusted `main`, rejects forks, and copies the opaque artifact into the approved external WORM store. Missing files, schema or commit mismatch, incomplete provenance, missing S3 version ID, checksum/KMS mismatch, non-compliance lock mode, effective retention below 365 days, or an artifact not bound to the source run fail archival.

The external archive is a release gate, not a substitute for pull-request checks. A change may not receive a WP-00 or release PASS until the immutable receipt key/version is recorded and independently verified, even if GitHub merge checks are green.

## Emergency bypass

Bypass is permitted only when delaying a change creates a greater immediate safety risk than merging without normal gates. It requires explicit project-owner or delegated incident-commander authorization, a documented emergency record, the exact commit SHA, immediate post-merge checks, rollback on failure, and a post-incident review. Delivery pressure and routine maintenance are not emergencies.

## Verification procedure

1. Open a test pull request from a non-protected branch.
2. Confirm all required checks are created.
3. Intentionally fail one required check and confirm merge is blocked.
4. Restore the candidate and confirm merge remains blocked until every required check succeeds and review requirements are satisfied.
5. Verify the source artifact's three commit identities against the pull-request event.
6. Confirm `Archive CI Evidence` produced a WORM receipt for the same run and SHA.
7. Independently verify the receipt's S3 version, KMS key, SHA-256, and ≥365-day compliance retention.
8. Record the pull request, source workflow, archive workflow, receipt key, and receipt version in release-readiness evidence.

## Ownership

- CI configuration: Platform/DevOps owner
- Branch ruleset: Repository administrator
- Safety-gate approval: Project owner or delegated safety authority
- Evidence retention: Release manager
