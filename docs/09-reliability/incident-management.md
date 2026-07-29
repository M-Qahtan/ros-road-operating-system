# Incident management

## Objectives

Incident response protects people first, preserves evidence and audit history, restores safe service, and prevents recurrence. Traffic restoration is secondary to human safety, evidence integrity, and lawful authority.

## Severity model

| Level | Definition | Initial acknowledgement | Executive notification | Update cadence |
|---|---|---:|---:|---:|
| P0 | Actual or imminent risk to life; unauthorized S3/S4 action; false safety acknowledgement; systemic loss of human escalation; critical evidence or authority breach | 5 minutes | Immediate | Every 15 minutes |
| P1 | Release-blocking safety, security, privacy, restore, readiness, or audit failure without confirmed human harm | 15 minutes | Within 30 minutes | Every 30 minutes |
| P2 | Material service degradation with safe fallbacks intact | 30 minutes | Within 2 hours | Hourly |
| P3 | Limited non-safety defect or operational inconvenience | One business day | In routine report | Daily as needed |

## Command roles

- Incident Commander: owns coordination, priorities, and decision log.
- Safety Lead: protects human-safety invariants and may stop release or automation.
- Technical Lead: diagnosis, containment, recovery, and verification.
- Security/Privacy Lead: access, secrets, evidence, notification, and regulatory assessment.
- Communications Lead: accurate stakeholder updates without exposing protected information.
- Scribe: immutable timeline, evidence references, decisions, assumptions, and actions.

No role may use incident pressure to bypass medical, legal, governmental, or human-authority boundaries.

## Response lifecycle

1. Detect and declare severity.
2. Stabilize human-safety paths and stop unsafe automation.
3. Preserve logs, evidence, audit records, and candidate identities.
4. Contain the failure using the smallest reversible action.
5. Recover dependencies and verify readiness, data integrity, and authorization.
6. Run required CI, Security, restore, staging, Riyadh, and failure-mode gates.
7. Obtain explicit release/return-to-service authorization.
8. Conduct post-incident review and track corrective actions.

## Escalation triggers

Immediate founder or delegated safety-authority notification is required for confirmed P0, repeated P1, unauthorized production/government action, residual risk acceptance, evidence destruction, or inability to restore a human-safety control.

## Communication rules

Updates distinguish confirmed facts, hypotheses, mitigations, and residual risk. They must not include raw medical details, precise location, evidence content, credentials, or personal identifiers unless the recipient is authorized and the disclosure is necessary and recorded.
