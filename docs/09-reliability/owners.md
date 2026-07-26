# Reliability Ownership

| Area | Accountable role | Operational owner | Escalation |
|---|---|---|---|
| Safety invariants | Safety Lead | Domain/API owner | Incident Commander |
| Signal ingestion and RoadEvent creation | Backend Lead | API/Data on-call | Safety Lead |
| Human-safety escalation | Safety Lead | Workflow on-call | Incident Commander |
| Notifications and outbox | Integration Lead | Messaging on-call | Safety Lead |
| Evidence integrity and access | Security Lead | Evidence service owner | Incident Commander |
| Dashboard freshness and controls | Operations Product Lead | Dashboard owner | Safety Lead |
| Backup, restore, RPO/RTO | Reliability Lead | SRE on-call | Release Manager |
| CI release evidence | Release Manager | DevOps owner | Reliability Lead |
| Incident communication | Incident Commander | Communications Lead | Project leadership |

Named individuals are assigned before any pilot deployment. Until then, the role—not an assumed person—owns the gate.
