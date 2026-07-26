# Secrets and software supply-chain controls

## Environment boundaries

| Environment | Credential source | Rules |
|---|---|---|
| Local development | Developer-owned `.env` copied from documented examples | Never commit real values; use isolated local accounts and short-lived credentials where possible. |
| CI | Per-run ephemeral values derived from GitHub run identity for isolated test services | Values are test-only, unique per run, never reusable outside the runner, and never accepted by staging or production. |
| Staging | GitHub Environment or external secret manager | Protected environment, named approvers, least privilege, audit logging, rotation and expiry required. |
| Production | Approved external secret manager with workload identity | No long-lived credentials in repository or workflow YAML; dual control for emergency access; full audit and rapid revocation. |

CI values are not production secrets. They are deliberately ephemeral test credentials and must not be copied into any deployed environment.

## Workflow trust rules

1. Third-party actions are pinned to immutable commit SHAs and annotated with the reviewed release version.
2. Workflow permissions default to `contents: read`; elevated permissions require a documented job-level reason.
3. Checkout disables persisted GitHub credentials.
4. Critical dependency findings, committed credential patterns, missing SBOM output, or failed security evidence uploads block the workflow.
5. Security evidence artifacts include the exact commit SHA and are retained for release review.
6. Changes to workflow files require security review before merge.

## Credential rotation runbook

1. **Contain:** disable the affected credential or identity immediately and block deployments using it.
2. **Assess:** identify environments, services, logs, artifacts and commits where the value may have appeared.
3. **Replace:** issue a new least-privilege credential through the approved secret manager; never edit a committed value into another value.
4. **Deploy:** update the protected environment, restart or redeploy consumers, and verify authentication and authorization paths.
5. **Revoke:** revoke the old credential after verified cutover, or immediately when active compromise is suspected.
6. **Clean:** remove exposed values from logs and artifacts where supported. Rewriting Git history requires explicit incident approval because clones and caches may retain the value.
7. **Validate:** run secret scanning, dependency checks, staging smoke tests and access-log review.
8. **Record:** create an incident record with cause, exposure window, affected systems, actions, owner and prevention work.

## Release evidence

Every release candidate must provide:

- successful CI and security workflows;
- a CycloneDX SBOM tied to the commit SHA and lockfile digest;
- zero critical dependency audit findings;
- a passing tracked-file secret scan;
- immutable action references;
- documented approval for any temporary exception.

Exceptions expire, identify an owner and compensating control, and cannot waive a life-safety invariant.
