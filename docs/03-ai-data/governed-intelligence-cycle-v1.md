# Governed Road Intelligence Cycle v1

## Why this slice exists

ROS now has three independently tested intelligence layers on `main`:

1. Cognitive Road State (CRS);
2. Epistemic Coverage Map (ECM) and decision-critical coverage gate;
3. advisory counterfactual ranking.

Those layers are strong individually, but a production architecture also needs one explicit composition boundary so downstream callers do not accidentally bypass epistemic coverage or confuse a recommendation with authority.

## Decision

Introduce a **Governed Road Intelligence Cycle** as a pure, read-only application primitive.

```text
Cognitive Road State
        +
Epistemic Coverage Map
        ↓
Decision-Critical Coverage Gate
        ↓
Coverage-Governed Counterfactual Evaluation
        ↓
Governed Intelligence Result
        ↓
Future Operations Read Model / Human Review
```

## Invariants

The cycle always returns:

- `authority = NONE`;
- `candidateAuthorityCeiling = ADVISORY_ONLY`;
- `executionAuthorized = false`;
- `publicRoadAuthorized = false`;
- `externalIntegrationAuthorized = false`;
- `directVehicleControl = false`;
- `negativeSceneInferenceAuthorized = false`.

A recommendation is therefore information, not permission.

## Fail-closed behavior

- UNKNOWN / BLIND / materially DEGRADED decision-critical coverage -> `REQUEST_MORE_EVIDENCE`;
- material contradiction -> `ABSTAIN`;
- stale/mismatched CRS or coverage evidence -> blocked by existing gates;
- malformed or authority-violating counterfactual candidates -> `ABSTAIN`;
- direct vehicle-control candidates remain forbidden.

## Requirement → Hazard → Code → Test → Evidence

**Requirement:** compose CRS, coverage and counterfactual intelligence through one governed boundary.

**Hazards:**
- downstream code bypasses coverage and ranks candidates directly;
- a recommendation is interpreted as an executable command;
- a malicious candidate imports direct vehicle-control authority;
- unknown coverage is treated as proof of an empty/safe corridor.

**Code:**
`apps/api/src/perception/governed-intelligence-cycle.ts`

**Tests:**
`apps/api/src/perception/governed-intelligence-cycle.spec.ts`

**Evidence target:**
exact-head CI, Security, Riyadh Failure-Mode Safety and Runtime Driver Integration results for the candidate PR.

## What this does not do

This slice does not:

- expose a new public API;
- persist live sensor data;
- activate devices or cameras;
- contact external partners;
- dispatch emergency services;
- control traffic signals;
- control vehicles;
- deploy to staging or production.

## Next integration gate

After independent review, the next safe step is to build a **read-only Operations Intelligence Read Model** that can expose this result to the authenticated operations dashboard. That read model should preserve exact CRS/map/evidence digests and must not create a command path.
