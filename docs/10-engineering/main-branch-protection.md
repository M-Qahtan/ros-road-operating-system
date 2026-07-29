# Main branch protection and required CI evidence

This document defines the minimum merge controls for `main` in the ROS repository. These controls are release gates for a safety-relevant system and must not be weakened for convenience.

## Required workflow triggers

The `CI` and `Security` workflows must run on every pull request and every push to `main`.

## Required checks

The `main` ruleset requires these GitHub Actions checks:

1. `verify`
2. `postgres-integration`
3. `staging-smoke`
4. `riyadh-e2e`
5. `dependency-review`
6. `repository-security`

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

The workflow validates every manifest before upload. Missing files, schema mismatch, commit mismatch, or incomplete evidence fail the job. Artifacts are retained for at least 30 days; release evidence requiring longer retention must be copied to the approved evidence store.

## Emergency bypass

Bypass is permitted only when delaying a change creates a greater immediate safety risk than merging without normal gates. It requires explicit project-owner or delegated incident-commander authorization, a documented emergency record, the exact commit SHA, immediate post-merge checks, rollback on failure, and a post-incident review. Delivery pressure and routine maintenance are not emergencies.

## Verification procedure

1. Open a test pull request from a non-protected branch.
2. Confirm all required checks are created.
3. Intentionally fail one required check and confirm merge is blocked.
4. Restore the candidate and confirm merge remains blocked until every required check succeeds and review requirements are satisfied.
5. Download evidence artifacts and verify the three commit identities against the pull-request event.
6. Record the pull request and workflow runs in release-readiness evidence.

## Ownership

- CI configuration: Platform/DevOps owner
- Branch ruleset: Repository administrator
- Safety-gate approval: Project owner or delegated safety authority
- Evidence retention: Release manager
