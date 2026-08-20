# Pilot Evidence Plan

Status: **EVIDENCE SCHEMA / COLLECTION PLAN — NO FIELD EXECUTION CLAIMED**

## 1. Objective

Every device/field/pilot claim must be traceable to the exact ROS candidate, scenario, configuration and observed outcome. Evidence must preserve failures, abstentions and degraded states—not only successful paths.

## 2. Required manifest fields

Each executed scenario evidence package must identify:

- evidence schema version;
- repository and exact candidate head SHA;
- tested build/package identifier;
- scenario ID and matrix version;
- pilot/rehearsal phase;
- environment classification;
- device class/model and OS version where applicable;
- language/accessibility mode where applicable;
- network/GPS/fault profile;
- tenant/purpose test scope;
- start/end timestamps and trusted time source;
- expected safe state;
- observed outcome: PASS / FAIL / ABSTAIN;
- relevant RoadEvent/operation/idempotency/trace identifiers;
- safety/hazard references;
- evidence file checksums where applicable;
- collector and independent reviewer;
- unresolved defect/finding reference.

## 3. Candidate integrity

Evidence is invalid for acceptance if:

- the candidate SHA is missing or ambiguous;
- source/build changed after evidence collection without re-verification;
- a failed/abstained scenario was silently removed from the denominator;
- the manifest cannot be reconciled with durable server/audit evidence where the scenario depends on it;
- required integrity/checksum evidence is missing.

## 4. Privacy and secrets

Evidence collection must be minimum necessary. Do not include:

- production private keys/secrets;
- unnecessary personal identifiers;
- unrelated camera frames;
- unrelated health/insurance data;
- raw partner trust material beyond approved public fingerprints/verification metadata.

Redaction itself must not remove information required to reproduce a safety conclusion.

## 5. Negative evidence

The evidence package must preserve:

- rejected stale state;
- rejected callback replay;
- rejected cross-tenant/purpose path;
- ABSTAIN decisions;
- kill-switch test;
- rollback test;
- dependency outage/degraded behavior;
- GPS/location uncertainty behavior;
- restart/reconnect reconciliation;
- accessibility failures as well as passes.

## 6. Review decision

A field evidence bundle is not self-approving. Independent safety/security/operations reviewers must reconcile the bundle against the matrix and KPI/stop criteria before it can support a readiness recommendation.
