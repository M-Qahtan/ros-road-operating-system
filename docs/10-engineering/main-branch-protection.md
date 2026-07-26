# Main branch protection and required CI evidence

This document defines the minimum merge controls for `main` in the ROS repository. These controls are release gates for a safety-relevant system and must not be weakened for convenience.

## Required workflow triggers

The `CI` workflow must run on:

- every `pull_request` targeting the repository;
- every push to `main`.

## Required checks

Configure the `main` branch ruleset to require all of the following checks before merge:

1. `CI / verify`
2. `CI / postgres-integration`
3. `CI / staging-smoke`
4. `CI / riyadh-e2e`

A missing, skipped, cancelled, stale, or failed required check is a merge blocker.

## Required pull-request controls

The `main` ruleset should enforce:

- pull requests are required before merging;
- at least one approving review is required;
- approvals are dismissed when new commits are pushed;
- conversations must be resolved before merge;
- the branch must be up to date with `main` before merge;
- force pushes and branch deletion are blocked;
- administrators are included in enforcement;
- direct pushes are blocked except through the emergency bypass below.

## Traceable CI evidence

Every required job uploads an evidence artifact whose name contains:

- the full commit SHA;
- the workflow run ID;
- the run attempt.

Each artifact also includes a JSON evidence manifest with the repository, workflow, event, ref, commit SHA, run ID, and run attempt. This allows test evidence to be traced back to the exact source revision.

Artifacts are retained for at least 30 days. Pilot or release evidence that must be retained longer should be copied into the approved release evidence store.

## Emergency bypass

Bypass is permitted only when delaying a change creates a greater immediate safety risk than merging without the normal gates.

The bypass requires:

1. explicit authorization from the project owner or delegated incident commander;
2. a documented incident or emergency change record;
3. the exact commit SHA and reason for bypass;
4. immediate post-merge execution of all four required checks;
5. rollback if any required check fails;
6. a post-incident review and corrective action within the next working cycle.

The bypass must never be used for delivery pressure, convenience, or routine maintenance.

## Verification procedure

After configuring the ruleset:

1. open a test pull request from a non-protected branch;
2. confirm all four checks are created;
3. intentionally fail one check and confirm merge is blocked;
4. restore the check and confirm merge remains blocked until every required check succeeds and review requirements are met;
5. download each evidence artifact and verify its manifest matches the pull-request head SHA;
6. record the test pull request and workflow run links in the release-readiness evidence.

## Ownership

- CI configuration: Platform/DevOps owner
- Branch ruleset: Repository administrator
- Safety-gate approval: Project owner or delegated safety authority
- Evidence retention: Release manager
