# Post-incident review template

## Incident identity

- Incident ID:
- Severity:
- Start/end timestamps:
- Incident Commander:
- Candidate or production commit SHA:
- Affected services and regions:

## Human-safety assessment

- Was any person exposed to actual or potential harm?
- Were human contact, escalation, or authority controls delayed or bypassed?
- Did automation attempt medical diagnosis, legal-fault determination, real dispatch, severity downgrade, resolution, closure, or reopening?
- What immediate protective actions were taken?

## Timeline

Record detection, declaration, containment, decisions, communications, recovery, verification, and return-to-service events with timestamps and evidence references.

## Technical analysis

- Trigger and contributing conditions:
- Failed controls and detection gaps:
- Dependency, data, security, privacy, or human-factor contributors:
- Why existing tests or gates did not prevent the event:
- Evidence and audit integrity status:

## Recovery verification

- CI/Security/failure-mode/operational-readiness runs:
- PostgreSQL/PostGIS restore proof:
- Staging recovery proof:
- Data reconciliation completed:
- Residual risk and accepting authority:

## Corrective actions

Each action includes owner, priority, due date, acceptance test, related hazard/control, and evidence required for closure. Corrective actions are tracked as focused issues; the review does not assign personal blame.

## Approval

- Safety Lead:
- Security/Privacy Lead:
- Technical Lead:
- Release Manager:
- Founder or delegated authority for P0/P1:
