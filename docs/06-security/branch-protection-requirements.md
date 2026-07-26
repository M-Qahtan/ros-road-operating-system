# Security merge gates

Protect `main` with pull requests and require these checks before merge:

- `CI / verify`
- `CI / postgres-integration`
- `CI / staging-smoke`
- `CI / riyadh-e2e`
- `Security / dependency-review` for pull requests
- `Security / repository-security`

Require at least one approving review, dismiss stale approvals after new commits, require conversation resolution, block force pushes and deletion, and restrict bypass to an explicitly authorized emergency role. Any emergency bypass must create an incident record and a post-merge verification task.

A missing check is a failed check. Critical dependency findings, secret-scan findings, missing SBOM evidence, or failed restore/readiness proof block release.
