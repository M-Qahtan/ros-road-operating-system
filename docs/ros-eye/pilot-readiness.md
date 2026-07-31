# ROS Eye End-to-End Pilot Readiness

## Decision boundary

Passing this evidence package means only:

> The current ROS Eye implementation is engineering-ready for a controlled pilot-preparation process under approved scope, staffing, infrastructure, legal/privacy, clinical/human-factors, cybersecurity and government controls.

It does **not** authorize:

- public-road deployment;
- real ambulance, traffic, police or government integration;
- medical diagnosis or treatment guidance;
- legal-fault determination;
- autonomous S3/S4 downgrade, resolution, dispatch, road closure or reopening.

## One-command evidence

```bash
pnpm simulate:ros-eye
```

The command builds the repository, runs the deterministic ROS Eye vertical slice and writes:

- `artifacts/ros-eye/pilot-readiness/result.json`;
- `artifacts/ros-eye/pilot-readiness/pilot-readiness-report.json`;
- `artifacts/ros-eye/pilot-readiness/evidence.json`.

The GitHub Actions workflow binds the evidence to:

- candidate head SHA;
- candidate base SHA;
- tested merge SHA;
- workflow run ID;
- run attempt.

Missing files, mismatched SHAs, failed hazards, an invalid digest or an authorization claim blocks the evidence workflow.

## Deterministic scenario

1. Receive phone and vehicle impact signals for one Riyadh incident.
2. Accept trusted signals through the actual multimodal ingestion boundary.
3. inject one conflicting/low-quality infrastructure source and route it to human review.
4. Replay a previously accepted phone signal and prove it cannot create another logical signal or case.
5. Open the human-contact sequence.
6. Inject primary-channel failure, interruption and no response.
7. Switch to a fallback channel and then deterministic operator takeover.
8. Deliver duplicate and delayed callbacks and prove they cannot reverse takeover or duplicate contact.
9. Generate an explainable S3/S4 recommendation from corroborated impact, no-response and conflicting source evidence.
10. Prove the recommendation has no autonomous downgrade, closure or dispatch authority.
11. Upload trusted evidence; quarantine a checksum mismatch; reject cross-case access.
12. Inject object-storage, PostgreSQL, Redis, API restart and network-partition failure.
13. Restore state and prove readiness before accepting a new critical action.
14. Block stale-dashboard action.
15. Reject operator resolution; accept only supervisor resolution and road reopening after restored readiness.
16. Run a 2,000-input duplicate/load baseline without duplicate cases, contacts or accepted logical signals.
17. Run the existing Riyadh RoadEvent E2E scenario through recovery and authorized closure.

## Hazard evidence

| Hazard | Severity | Required safe state |
|---|---:|---|
| Replayed/duplicate signal | P0 | One HumanSafetyCase and two logical trusted signals |
| Conflicting/degraded source | P0 | Human review; S3-or-higher recommendation |
| Contact interruption/silence | P0 | No-response escalation and operator takeover |
| Duplicate/delayed callback | P1 | No duplicate contact and no reversal after takeover |
| Corrupt/cross-case evidence | P0 | Quarantine and scope denial |
| Object-storage outage | P1 | Pending retry; case remains open for review |
| PostgreSQL outage/restore | P0 | Writes fail closed; case restored before readiness |
| Redis outage/retry storm | P1 | One logical operational notification |
| Network/API restart | P0 | Callback and escalation state survive |
| Stale dashboard | P0 | Critical action blocked |
| Machine authority expansion | P0 | Recommendation-only output |
| Unauthorized resolution/reopening | P0 | Rejected until supervisor authority and readiness |
| Duplicate-load pressure | P1 | Bounded execution without duplicate entities |
| Road recovery claim | P0 | Evidence, recovery and human-authorized closure verified |

## Release gates

The dedicated pilot workflow is additive. Merge also remains blocked by the existing protected contexts:

- `verify`;
- `riyadh-e2e`;
- `postgres-restore`;
- `staging-fault-injection`;
- `security / dependency-review`;
- `security / repository-security`;
- `failure-mode-safety / riyadh-failure-modes`;
- `operational-readiness`.

## Residual risk and staffing

The generated readiness report must preserve:

- limitations and simulation boundaries;
- residual device, carrier, connectivity, identity and representative-data risks;
- 24/7 operator and supervisor staffing needs for any live pilot window;
- incident command, privacy/security on-call and multidisciplinary content review;
- external transport/emergency-service, privacy/legal, clinical/human-factors and cybersecurity approvals;
- controlled geography, stop criteria and rollback plan.

## Privacy

The pilot artifact contains synthetic and de-identified identifiers only. It excludes raw conversation, medical narrative, phone number, national ID, credentials, access tokens and precise person-location fields. Existing CI secret scanning, SBOM and observability controls remain mandatory.
