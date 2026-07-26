# Incident Management for the Riyadh MVP

## Severity levels

| Level | Definition | Examples | Initial owner | Response target |
|---|---|---|---|---|
| P0 | confirmed or credible risk to human life, unsafe state transition, unauthorized closure, silent loss of high-risk event, or evidence authorization breach | missed S3/S4 escalation; road reopened without approval | Incident Commander + Safety Lead | immediate; continuous coordination |
| P1 | major service degradation that threatens safety guarantees if prolonged | durable outbox stalled; database unavailable; restore uncertainty | Incident Commander + Service Owner | acknowledge within 5 min |
| P2 | degraded traffic efficiency or operator workflow with safe fallback | stale dashboard with critical actions blocked | Service Owner | acknowledge within 30 min |
| P3 | minor defect without material operational impact | non-critical reporting mismatch | Product/Engineering Owner | next working cycle |

## Roles

- **Incident Commander:** owns decisions, timeline, severity, and handoffs.
- **Safety Lead:** validates human-safety impact and safety invariants.
- **Operations Lead:** coordinates operator communications and safe manual procedures.
- **Service Owner:** diagnoses and restores the affected capability.
- **Communications Lead:** issues approved internal/stakeholder updates without exposing sensitive data.
- **Scribe:** preserves timestamps, decisions, evidence references, and action items.

## Escalation

1. Declare severity using available evidence; when uncertain between P0 and P1, choose P0.
2. Freeze risky changes and preserve logs/audit artifacts.
3. Confirm safe degradation: block critical dashboard actions, retain durable intent, and expose dependency failure.
4. Escalate to the Safety Lead for every P0/P1 affecting RoadEvent creation, human-safety workflow, closure, notifications, evidence, or recovery.
5. Start rollback when a mandatory rollback condition is met.
6. Reclassify only with recorded rationale and Incident Commander approval.

## Communication cadence

- P0: initial update as soon as facts are verified, then every 15 minutes.
- P1: initial update within 10 minutes, then every 30 minutes.
- P2: update at meaningful state changes.

Updates include impact, safe state, actions, owner, next decision point, and known uncertainty. Never include names, phone numbers, medical narratives, raw coordinates, evidence content, credentials, or access tokens.

## Resolution criteria

An incident is resolved only when:

- the affected safety invariant is proven;
- durable state and evidence integrity are verified;
- backlog/retry/dead-letter state is reconciled;
- readiness probes are healthy;
- operators receive a clear recovery confirmation;
- required monitoring remains stable for the defined observation period.

## Post-incident review

Complete within five working days for P0/P1. The review is blameless and includes:

1. executive summary and user/safety impact;
2. exact timeline from detection to recovery;
3. contributing technical and organizational factors;
4. controls that worked and failed;
5. data integrity, evidence, privacy, and notification reconciliation;
6. RPO/RTO achieved versus target;
7. corrective actions with owner, priority, due date, and verification test;
8. required updates to hazards, controls, runbooks, SLOs, and release gates.

No action closes without objective verification evidence.
