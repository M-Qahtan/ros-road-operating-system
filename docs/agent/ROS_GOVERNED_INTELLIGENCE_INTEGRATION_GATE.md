# Governed Intelligence Integration Gate — Evidence Reconciliation

Date: 2026-10-03

## Material finding

PR #175 `feat(intelligence): compose governed road intelligence cycle` is a clean four-commit descendant of current `main@3255a94a7f78607014a410e083174483fa2c2c2f` with no behind commits.

Reviewed head: `8507f0109cdfecec6735ea8dfd2212a123b5ade9`.

Exact-head GitHub Actions evidence on that SHA is green for:
- CI
- Security
- Riyadh Failure-Mode Safety
- Runtime Driver Integration
- Operational Readiness
- Object Storage Integration

An independent GitHub reviewer approved the reviewed head and explicitly found no blocking architectural, security, governance, or authority-expansion issue. This evidence is bounded to the reviewed head and does not authorize production/public-road/external actuation.

## What #175 actually proves

It creates one read-only composition boundary:

`CRS + Epistemic Coverage -> coverage gate -> counterfactual evaluation -> governed intelligence result`

Hard boundary remains:
- `authority=NONE`
- `candidateAuthorityCeiling=ADVISORY_ONLY`
- `executionAuthorized=false`
- `publicRoadAuthorized=false`
- `externalIntegrationAuthorized=false`
- `directVehicleControl=false`
- `negativeSceneInferenceAuthorized=false`

Unknown decision-critical coverage requests more evidence; malformed direct-control candidates fail closed.

## Executive decision

Do **not** reimplement this composition on the agent branch. #175 is the current candidate cognitive composition slice and has independent-review + exact-head green evidence.

The next P0 integration slice is downstream, not another Brain module:

`Governed Intelligence Result -> ROS Heart -> Human Review / Operations Read Model -> Audit`

The Heart boundary must be independently testable and must not mutate #175 into an execution path.

## Required Heart outcomes

Only these bounded outcomes may leave the Heart gate:
- `VETO`
- `REQUEST_MORE_EVIDENCE`
- `REQUEST_HUMAN_REVIEW`
- `ALLOW_ADVISORY`

`ALLOW_ADVISORY` is still not execution permission.

## Mandatory negative tests for the next slice

1. stale/expired CRS or coverage digest -> fail closed;
2. purpose mismatch -> veto;
3. jurisdiction mismatch -> veto;
4. tenant/subject authority mismatch -> veto;
5. direct vehicle-control candidate -> veto;
6. cognition attempts to set execution/public-road/external authority -> veto;
7. missing/failed audit persistence -> no advisory release;
8. replay/duplicate decision request -> idempotent, no authority multiplication;
9. degraded/compromised component -> authority may only decrease;
10. human-review-required severity -> cannot become `ALLOW_ADVISORY` without the required review context.

## Merge/gate posture

#175 is review-ready from an engineering-evidence perspective, but this agent does not self-merge or self-approve safety/authority-critical work. Preserve independent governance.

Whole-body status remains `NOT_PROVEN`; controlled pilot remains `NO_GO` until the full path is demonstrated on one final candidate SHA.
