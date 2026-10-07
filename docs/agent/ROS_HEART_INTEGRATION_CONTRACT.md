# ROS Heart Integration Contract — P0 Freeze Candidate

Status: **FROZEN CANDIDATE / NOT YET RELEASE-GATED**

This contract defines the smallest safe bridge from bounded cognitive recommendations into the existing Human Safety authority plane. It deliberately reuses existing authority/lifecycle controls rather than creating a second authority system.

## Architectural rule

```text
Evidence Assurance / CPAL-EIL
  -> Cognitive Road State
  -> Governed Intelligence (authority=NONE / advisory only)
  -> ROS Heart Adapter
  -> Human Safety / Operations review
  -> immutable audit
```

The Heart is a governance adapter and veto gate. It is not an executor and never upgrades cognitive output into physical authority.

## Inputs

A Heart evaluation MUST bind:
- tenant and purpose context;
- jurisdiction/mission context where applicable;
- exact RoadEvent / HumanSafetyCase identity;
- evidence revision and evidence quality;
- CRS/state digest, version and expiry;
- recommendation digest, provenance and expiry;
- connectivity/dependency health;
- compromise/degradation state;
- actor/role context for any human action;
- trace/idempotency context;
- policy versions used for the decision.

Missing or unverifiable mandatory context fails closed.

## Allowed outcomes

Only:
- `VETO`
- `REQUEST_MORE_EVIDENCE`
- `REQUEST_HUMAN_REVIEW`
- `ALLOW_ADVISORY`

`ALLOW_ADVISORY` means the recommendation may be displayed/queued for an authorized human workflow. It does **not** grant execution authority, dispatch authority, signal-control authority, or vehicle actuation authority.

## Existing authority plane to reuse

The implementation MUST reuse the Human Safety contract and lifecycle rather than inventing parallel roles/permissions. Existing controls include:
- role-scoped authorities;
- S3/S4 resolution restricted to Supervisor/Safety Lead;
- authorization bound to actor, case version, severity assessment, evidence revision and indicator revision;
- trusted evaluation time and expiry;
- replay protection;
- evidence-quality and dependency-health fail-closed behavior;
- immutable/auditable lifecycle transitions;
- post-resolution reactivation without inheriting stale authority.

## Mandatory veto / downgrade conditions

The Heart MUST NOT emit `ALLOW_ADVISORY` when any applicable condition is true:
1. evidence or CRS is stale/expired;
2. evidence is missing, quarantined, materially conflicting, or independence is unproven for a required quorum;
3. tenant, purpose, jurisdiction or mission context mismatches;
4. recommendation attempts to import or synthesize authority from Brain/model output;
5. recommendation requests direct brake/steer, traffic-signal actuation, live emergency dispatch, or another prohibited physical action;
6. required audit persistence is unavailable or outcome is ambiguous;
7. replay/idempotency validation fails;
8. critical dependency health is unavailable;
9. component compromise/degradation would cause authority to increase;
10. policy/version/digest binding is absent or inconsistent.

When uncertainty can be resolved safely, choose `REQUEST_MORE_EVIDENCE` or `REQUEST_HUMAN_REVIEW`; otherwise `VETO`.

## Machine-test gate

Before this bridge can be called BUILT, tests must prove:
- Brain output with `authority=NONE` cannot become execution authority.
- Heart veto dominates any recommendation ranking/optimization.
- stale evidence and stale CRS fail closed.
- tenant/purpose/jurisdiction mismatch fails closed.
- direct-control proposal is vetoed.
- audit persistence failure cannot produce an allowed operational transition.
- replay/duplicate input cannot produce a second effective transition.
- degraded/compromised components can only preserve or reduce authority.
- human high-risk authorization is actor/version/evidence bound and expires.
- `ALLOW_ADVISORY` reaches Operations as advisory/read-model data only.

## Release evidence required

A future implementation PR must provide:
1. exact candidate SHA;
2. typed/versioned Heart input/output contract;
3. adapter implementation using existing Human Safety authority APIs;
4. negative tests above;
5. end-to-end controlled scenario through Operations + audit;
6. independent review of safety/authority behavior.

Until all six exist, Whole-Body E2E remains NOT_PROVEN and controlled-pilot status remains NO_GO.
