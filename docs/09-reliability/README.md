# ROS reliability and operational assurance

This directory defines the release, recovery, incident, observability, and service-level controls for the Riyadh MVP. These controls are engineering gates for a safety-relevant platform; they do not authorize production government integration or replace statutory, medical, legal, or operational approvals.

## Control set

- `safety-and-traffic-slos.md` — life-safety indicators, traffic objectives, and error-budget separation.
- `operational-readiness-and-release-gates.md` — mandatory evidence and release decision rules.
- `fault-injection-matrix.md` — controlled staging failure scenarios and required safe states.
- `recovery-drill.md` — PostgreSQL/PostGIS backup and restore proof.
- `incident-management.md` — severity, ownership, escalation, communication, and review.
- `observability-data-policy.md` — telemetry allow-list, deny-list, retention, and access boundaries.
- `ci-evidence-contract.md` — commit identity and artifact integrity requirements.
- `merge-gate.md` — repository enforcement and non-bypass conditions.

The operational readiness workflow fails closed when any required upstream gate is failed, cancelled, skipped, missing, stale, or cannot be tied to the candidate head and tested merge SHAs.
