# Release decision template

## Candidate identity

- Candidate head SHA:
- Candidate base SHA:
- Tested merge SHA:
- Pull request and scope:
- Release owner:

## Mandatory evidence

| Gate | Result | Workflow/run | Artifact/digest | Reviewer |
|---|---|---|---|---|
| Repository verify/build/lint/typecheck/tests |  |  |  |  |
| PostgreSQL/PostGIS migration and clean restore |  |  |  |  |
| Staging readiness and fault injection |  |  |  |  |
| Riyadh E2E |  |  |  |  |
| Security, secret scan, dependency audit, SBOM |  |  |  |  |
| Riyadh failure-mode safety |  |  |  |  |
| Operational readiness |  |  |  |  |

## Boundary confirmation

Confirm that the candidate introduces no unauthorized medical diagnosis, legal-fault determination, real government dispatch, autonomous S3/S4 downgrade/resolution, or autonomous road closure/reopening.

## Decision

- [ ] Approved for the stated non-production/pilot boundary.
- [ ] Approved for production only with listed external approvals.
- [ ] Rejected; rollback or remediation required.

## Residual risk

List each residual risk, affected hazard/control, probability and impact basis, compensating controls, expiry/review date, and named accepting authority. P0/P1 residual risk requires founder or delegated safety-authority approval.

## Rollback

- Trigger:
- Owner:
- Procedure:
- Recovery evidence required:
- Audit and data-preservation constraints:
