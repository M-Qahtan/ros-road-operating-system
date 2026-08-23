# Pilot Privacy, Consent and Field Runbooks

Status: **PREPARATION PLAN — REAL PARTICIPANTS/DATA SOURCES NOT YET AUTHORIZED**

## 1. Privacy and consent principles

Before any real participant or real partner data is used, the pilot package must identify:

- lawful/approved basis for collection;
- exact purpose;
- exact categories of data;
- minimum-necessary fields;
- participant notice/consent path where required;
- retention/deletion policy;
- approved recipients/partners;
- evidence/audit requirements;
- break-glass conditions if any;
- participant support/contact process;
- withdrawal/correction handling where applicable.

No engineering simulation evidence constitutes privacy/legal approval for real people.

## 2. Data minimization by default

Prefer, in order:

1. synthetic data;
2. controlled test identities;
3. prerecorded/approved non-personal scenarios;
4. pseudonymous field identifiers;
5. real personal data only when the approved pilot purpose genuinely requires it.

Do not collect evidence because it is technically available. Collect only what the approved scenario and evidence plan require.

## 3. Prohibited without separate approval

- production public CCTV/live-camera feeds;
- covert surveillance;
- facial recognition or identity inference not separately approved;
- vehicle-control telemetry beyond approved read-only test scope;
- production health/medical records;
- legal-fault automation;
- unrelated insurer/person identifiers;
- raw data sharing outside the approved partner projection.

## 4. Field evidence handling

Every field evidence item should carry:

- pilot scenario ID;
- exact build/head SHA;
- purpose/tenant;
- collection timestamp/time source;
- source/device class;
- minimum-necessary content classification;
- checksum/integrity metadata where applicable;
- access/retention label;
- reviewer.

Screenshots/video/logs must be redacted/minimized where possible. Do not put production secrets or private keys in evidence artifacts.

## 5. Runbook — connectivity loss

Trigger: mobile/operator/backend connectivity unavailable or materially degraded.

Actions:
1. show degraded/offline state explicitly;
2. stop any path that requires a current server decision;
3. retain only approved durable/idempotent queue entries;
4. do not show an external dispatch/acknowledgement that was not actually confirmed;
5. on reconnect, revalidate stale state and reconcile by stable operation/idempotency identity;
6. stop if duplicate logical action is observed.

## 6. Runbook — GPS/location degradation

Trigger: stale, low-quality, impossible jump, no-fix or simulator-detected anomaly.

Actions:
1. mark location uncertainty;
2. reduce confidence / ABSTAIN where correlation is unsafe;
3. do not infer exact incident location from stale last-known coordinates;
4. preserve source quality/provenance;
5. require human confirmation for any high-risk consequence;
6. record recovery and compare against ground truth in approved tests.

## 7. Runbook — operator overload

Trigger: critical queue exceeds safely supervised capacity or overdue critical cases cannot be reviewed.

Actions:
1. surface overload state prominently;
2. prioritize S3/S4 visibility and human acquisition;
3. suspend nonessential pilot workload where needed;
4. do not permit automation to downgrade critical cases to reduce queue size;
5. escalate to Pilot Safety Lead/Operations Supervisor;
6. activate stop/kill procedure if adequate critical review cannot be maintained.

## 8. Runbook — evidence integrity failure

Trigger: checksum mismatch, missing required audit record, quarantine event, inconsistent candidate identity or evidence reconstruction failure.

Actions:
1. quarantine affected evidence/path;
2. prevent it from silently supporting an operational conclusion;
3. record integrity failure and affected scope;
4. preserve original material where governance permits;
5. stop the affected scenario if decision reconstruction is compromised;
6. require independent review before acceptance.

## 9. Runbook — security/trust failure

Trigger: invalid/revoked certificate/key, signature mismatch, callback replay, tenant/purpose violation, suspected credential compromise or trust-service outage.

Actions:
1. fail closed;
2. isolate the affected partner/profile;
3. do not retry with weakened authentication;
4. preserve audit/evidence;
5. initiate credential revocation/rotation procedure if applicable;
6. stop any scenario dependent on that trust path;
7. resume only after approved trust material and verification evidence are restored.

## 10. Runbook — stale state / duplicate logical action

Either condition is a hard safety stop.

Actions:
1. stop affected action path immediately;
2. capture operation/event/idempotency/fence identifiers;
3. do not auto-delete ambiguous durable reservation/evidence;
4. reconcile against committed domain state and exact evidence;
5. open P0/P1 triage as appropriate;
6. do not resume pilot consideration until root cause is validated and fresh exact-head evidence passes.

## 11. Runbook — S3/S4 human authority unavailable

Trigger: qualified reviewer/takeover path unavailable.

Action: **STOP / NO-GO** for any scenario requiring that authority. Automation may not substitute for the absent human reviewer.

## 12. Runbook — unauthorized capability activation

Triggers include real dispatch, public-road autonomous intervention, production camera access, vehicle actuation, clinical/legal automation or unapproved data sharing.

Actions:
1. activate kill/stop procedure;
2. isolate the capability;
3. preserve evidence;
4. notify security/safety/operations/founder governance path;
5. treat as incident, not as a successful pilot event;
6. require explicit reauthorization after remediation.

## 13. Current status

- privacy/consent framework: `DEFINED_NOT_EXTERNALLY_APPROVED`;
- field runbooks: `DEFINED_NOT_FIELD_EXECUTED`;
- real participant protocol: `PENDING`;
- real data-sharing agreements: `PENDING`;
- production camera/vehicle programs: `FORBIDDEN_UNTIL_SEPARATELY_APPROVED`.
