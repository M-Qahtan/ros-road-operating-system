# Riyadh Controlled Pilot Field-Validation Plan

Status: **engineering draft for governed approval review**

This plan operationalizes the existing Riyadh and ROS Eye pilot-readiness requirements. It does not authorize a public-road pilot. The current software evidence remains a technical/engineering proof until runtime readiness, integration-sandbox readiness, field validation, external approvals and founder authorization are all complete.

## 1. Decision boundary

A successful execution of this plan may support the decision:

`READY_FOR_GOVERNED_RIYADH_PILOT_APPROVAL_REVIEW`

It must never be interpreted as permission for:

- public-road deployment;
- live ambulance, police, traffic or government dispatch;
- production camera ingestion;
- vehicle actuation;
- medical diagnosis or legal-fault determination;
- autonomous S3/S4 downgrade, closure, dispatch, road closure or reopening.

All high-risk actions remain human-controlled. AI remains recommendation-only and must abstain when evidence is insufficient or conflicting.

## 2. Entry dependencies

The field program remains NO-GO until the evidence package can prove all of the following:

1. #79 reaches `RUNTIME_READY_FOR_STAGING` with fail-closed tenant/purpose isolation, persistent runtime semantics, backup/restore and failure evidence.
2. #80 reaches `INTEGRATION_SANDBOX_READY` with trusted caller identity, authenticated/replay-safe callbacks and no real endpoint contact from automated tests.
3. Existing protected CI, security, Riyadh failure-mode and operational-readiness contexts pass on the exact candidate head.
4. No unresolved P0/P1 safety or security finding remains.
5. Required privacy/legal, cybersecurity, human-factors and external-agency approvals are complete for the exact proposed scope.
6. Founder approval identifies the actual geography, date/window, participants and residual-risk acceptance. These values are intentionally **TBD** in this engineering draft.

## 3. Draft pilot charter

### Objective

Demonstrate that ROS can preserve its simulation-proven safety properties under representative devices, connectivity, sensor degradation, operator load and restart/recovery conditions before any public-road exposure is considered.

### Engineering scope before founder/external approval

- laboratory and Hardware/Device-in-the-Loop validation;
- synthetic/de-identified incidents and identities;
- simulated agency acknowledgements only;
- representative mobile devices and network degradation;
- command-center/operator simulation;
- shadow/recommendation-only ROS Eye output;
- evidence capture, audit reconstruction and rollback drills.

### Explicit exclusions

- real emergency dispatch;
- real traffic-control command;
- production camera feeds;
- public surveillance;
- real vehicle control;
- clinical or legal decision authority;
- autonomous high-severity state transitions.

## 4. Field-validation matrix

Each row requires: exact build SHA, device/runtime identifier, scenario seed, start/end timestamps, expected safe state, observed state, pass/fail, operator identity class, trace ID and evidence digest.

| Area | Minimum representative conditions | Required safe outcome |
|---|---|---|
| GPS | nominal, degraded accuracy, stale location, tunnel/urban-canyon simulation, sudden jump | stale/degraded data is visibly qualified; no unsafe certainty |
| Network | nominal, high latency, packet loss, full offline, reconnect, repeated disconnect | local queue remains bounded; replay is idempotent; no duplicate logical action |
| App lifecycle | foreground, background, force-stop, process restart, device reboot | durable state recovers; stale callbacks cannot reverse newer authority state |
| Clock | correct time, positive/negative skew, large invalid skew | freshness-sensitive operations fail closed when clock trust is insufficient |
| Battery | normal, low battery, power-saving mode | user safety flow remains usable; degradation is surfaced; no silent data loss claim |
| Permissions | granted, location revoked, notification revoked, camera unavailable | minimum-necessary fallback and explicit degraded state; no privilege bypass |
| Sensor quality | corroborated, low-confidence, conflicting, duplicate/replayed | weak/conflicting signals route to human review/ABSTAIN; duplicates do not multiply cases |
| Evidence | valid checksum, corrupt object, delayed upload, cross-case attempt | quarantine/retry/scope denial; immutable audit remains reconstructable |
| PostgreSQL | normal, connection loss, restart/restore | safety-critical writes fail closed and restore before readiness |
| Redis/queue | normal, outage, retry storm, reconnect | at-least-once transport does not create duplicate logical operational actions |
| Object storage | normal, outage, retry/recovery | case remains open/reviewable; evidence status is explicit |
| Operator console | fresh, stale view, reconnect, concurrent actions | stale/high-risk action is blocked; authority and version checks remain enforced |

## 5. Device and accessibility coverage

The representative device set must be approved before execution and must include at least:

- low-, mid- and high-resource Android classes;
- representative supported iPhone class(es) when the iOS client is in pilot scope;
- small and large screen sizes;
- Arabic RTL, English and Urdu localization paths;
- system font scaling and high text zoom;
- screen reader enabled;
- reduced-motion preference;
- one-hand/low-attention interaction;
- hands-free alternative for any flow that could otherwise distract a driver.

A device class is not PASS merely because the app launches. Critical flows must complete under restart, degraded network and accessibility settings with no loss of the safety/authority boundary.

## 6. Pilot KPI measurement specification

The project already defines the following success measures. This plan makes their measurement explicit without inventing production targets before safety/operations approval.

| KPI | Measurement definition | Evidence source |
|---|---|---|
| Time to detect | trusted first signal timestamp → initial detection timestamp | signal/audit timeline |
| Time to RoadEvent | trusted first signal → canonical RoadEvent creation | RoadEvent audit |
| Time to safety contact | HumanSafetyCase open → first contact attempt | contact timeline |
| No-response escalation time | no-response condition start → operator/escalation transition | append-only contact audit |
| Merge precision | correctly correlated signals / signals merged in controlled labelled set | deterministic/field-labelled corpus |
| Critical miss rate | labelled critical cases not escalated as required / labelled critical cases | safety evaluation corpus |
| Notification delivery | unique logical notifications acknowledged / unique notifications due | outbox/broker/consumer audit |
| Operator acknowledgement | item visible/assigned → first valid operator acknowledgement | command-center audit |
| Time to road recovery | RoadEvent creation → human-authorized restored-road state | RoadEvent timeline |
| Duplicate suppression | duplicate/replayed inputs that create no additional logical action / duplicate inputs injected | replay/idempotency evidence |
| Evidence completeness | required evidence objects with valid provenance/digest / required evidence objects | evidence manifest |

Numeric launch targets and tolerances are a governed decision and must be approved before the real pilot window. Regression baselines from current in-memory CI are not production SLAs.

## 7. Shadow, canary and rollback protocol

### Stage 0 — deterministic lab

- synthetic/de-identified data only;
- agency adapters simulated;
- all protected CI gates green;
- no external side effect.

### Stage 1 — Hardware/Device-in-the-Loop

- representative real devices;
- controlled network/GPS/sensor degradation;
- operator simulation;
- no public-road operation;
- recommendation output cannot trigger external action.

### Stage 2 — governed shadow validation

May begin only after the exact scope receives required approvals. ROS observes and recommends; authorized humans remain the sole source of operational action. A shadow recommendation is never treated as an instruction to an emergency or road-control system.

### Canary expansion

Any later expansion requires a new evidence review for the exact geography, participants, integrations and candidate SHA. Prior approval cannot be reused for materially wider scope.

### Immediate stop conditions

Stop the affected validation lane and preserve evidence if any of the following occurs:

- autonomous S3/S4 authority expansion or high-risk state transition;
- cross-tenant/cross-purpose data disclosure;
- duplicate logical external action after replay/retry;
- inability to reconstruct the safety-critical audit timeline;
- corrupt evidence accepted as trusted;
- stale operator state accepted for a critical action;
- backup/restore or restart recovery violates the defined safe state;
- an unresolved P0/P1 safety/security finding is discovered.

Rollback means returning to the last independently verified candidate and simulation-only boundary. It never means suppressing or deleting audit evidence.

## 8. Operator runbook and escalation matrix

| Trigger | Immediate safe action | Escalation |
|---|---|---|
| Critical signal conflict | ABSTAIN/review; preserve all qualified provenance | supervisor + safety lead |
| Contact silence/interruption | execute approved fallback; retain no-response state | operator takeover |
| Dependency outage | fail closed or enter documented degraded state | SRE/on-call + incident commander |
| Stale dashboard | block critical mutation | supervisor + platform on-call |
| Evidence checksum/provenance failure | quarantine; never promote to trusted evidence | security + evidence owner |
| Suspected privacy breach | stop affected data flow and preserve audit evidence | privacy/security incident response |
| Operator overload | freeze scope expansion and activate staffing/runbook controls | incident commander |
| Any P0/P1 discovery | stop affected lane | safety/security review board |

## 9. Evidence package

For each execution wave retain:

- exact candidate/base/tested merge SHAs;
- CI workflow/run/attempt identifiers;
- device and runtime class;
- scenario and fault-injection parameters;
- structured metrics and traces;
- pass/fail and safe-state assertions;
- operator/supervisor role class, without unnecessary personal data;
- audit/evidence digests;
- unresolved finding list and severity;
- approval records applicable to that exact scope.

Synthetic/de-identified identifiers remain the default. Do not place raw medical narrative, national identifiers, credentials, access tokens or unnecessary precise person-location data in CI artifacts.

## 10. Founder decision points

The engineering team must escalate only when one of these becomes necessary:

1. selection of actual Riyadh pilot geography;
2. pilot date/window and participant scope;
3. acceptance of material residual safety/privacy risk;
4. activation of any real agency/integration endpoint;
5. public-road exposure;
6. live camera scope;
7. any vehicle-actuation scope.

Until those decisions are explicitly approved, this plan remains a preparation and evidence program only.
