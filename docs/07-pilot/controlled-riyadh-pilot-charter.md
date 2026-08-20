# Controlled Riyadh Pilot Charter

Status: **ENGINEERING PREPARATION — NOT AUTHORIZED FOR PUBLIC-ROAD EXECUTION**

## 1. Purpose

The controlled Riyadh pilot exists to test whether ROS can preserve its engineering safety properties under representative field conditions before any public-road production decision.

The pilot is **not** a launch. It is a governed validation stage intended to measure detection, state integrity, operator workload, resilience, accessibility, evidence quality and safe degradation while retaining human authority.

## 2. Founder/external decisions intentionally left unresolved

This engineering package does **not** select or authorize:

- the actual Riyadh geography or road segment;
- the pilot calendar date/window;
- real participants or members of the public;
- any real ambulance, traffic, government, insurer, towing or routing endpoint;
- any production camera feed;
- any vehicle-control capability;
- any real data-sharing arrangement.

Those items remain explicit founder/external approval gates. Placeholder text in this package must never be interpreted as approval.

## 3. Proposed pilot progression

The engineering sequence is:

1. **Lab / deterministic simulation** — current software and safety evidence.
2. **Device-in-the-loop / controlled field rehearsal** — representative approved devices, no public-road authority.
3. **Shadow-only governed pilot** — only after geography, participants, privacy, operations and external dependencies are approved.
4. **Canary consideration** — only after shadow evidence is independently reviewed and a separate founder/external decision authorizes the next boundary.

No stage advances automatically.

## 4. In-scope engineering questions

- Does the mobile/field path survive restart, reconnect and network loss without duplicate logical actions?
- Does degraded GPS or clock skew move the system to a safe/uncertain state rather than fabricating confidence?
- Are S3/S4 cases always visible to qualified humans?
- Can an operator stop/rollback the pilot path immediately?
- Are stale states rejected before unsafe action?
- Can evidence be reconstructed with integrity and traceability?
- Do Arabic/English/Urdu and accessibility-critical flows remain usable on representative devices?
- What operator workload and takeover behavior is observed?
- Can the system remain SHADOW_ONLY and ABSTAIN on uncertainty under field stress?

## 5. Explicit exclusions

The controlled pilot preparation does not authorize:

- automatic emergency dispatch;
- autonomous road closure/reopening;
- clinical diagnosis;
- legal fault determination;
- autonomous S3/S4 downgrade or closure;
- production public surveillance;
- vehicle speed/lane/steering/braking control;
- use of unapproved personal or partner data;
- hidden expansion of geography, participants, operating hours or purpose.

## 6. Roles and authority model

| Role | Authority |
|---|---|
| Founder | Final decision on actual geography/date/participants and acceptance of material residual risk; no code can substitute for this authority |
| Pilot Safety Lead | May stop the pilot/rehearsal immediately; cannot waive safety gates |
| Operations Supervisor | Controls operator staffing, takeover and escalation; S3/S4 remains human |
| Security Lead | Owns trust, credential, incident and security-stop gates |
| Privacy/Legal | Approves participant/data-sharing/retention basis |
| Field Validation Lead | Executes approved device/scenario matrix and evidence capture |
| Engineering | Maintains software, diagnostics, rollback and evidence; cannot authorize live scope |
| Independent Reviewers | Review exact candidate evidence and residual P0/P1 risks |

## 7. Work Breakdown Structure

### WP-P1 — Scope and approval package
- define candidate-selection criteria for geography;
- define candidate operating-window criteria;
- define participant protocol template;
- map required external agencies/partners;
- record approvals without embedding secrets in source.

### WP-P2 — Device and field validation
- execute representative Android/iOS matrix;
- GPS degradation / urban canyon / tunnel-like loss;
- network loss and reconnection;
- low battery / power-management conditions;
- clock skew and stale state;
- process kill/restart/reboot where approved;
- camera/edge **simulators only** unless separately authorized;
- accessibility and multilingual critical flows.

### WP-P3 — Operations and safety controls
- staff S3/S4 human review;
- prove kill switch;
- prove rollback;
- prove operator-overload safe state;
- rehearse incident/escalation runbooks.

### WP-P4 — Measurement and evidence
- capture KPI denominator/numerator definitions;
- establish evidence manifest before the test;
- record device/build/config/time-source identifiers;
- preserve negative/abstained outcomes, not only successes;
- retain exact candidate SHA and test scope.

### WP-P5 — Independent review
- reconcile open hazards;
- review safety/security/privacy evidence;
- classify residual risk;
- issue PASS/NO-GO recommendation for founder review.

### WP-P6 — Founder/external decision
- no automatic execution;
- founder and required external authorities decide whether a governed pilot may begin and under what exact scope.

## 8. Entry criteria for real-device field validation

Real-device validation may begin only when:

- the device/test environment is controlled and approved;
- no real emergency/government action is triggered;
- data collection is minimum necessary;
- a stop procedure is available;
- test identities/data are used unless real participant approval exists;
- exact build SHA and evidence plan are recorded.

## 9. Exit criteria for the engineering package

The engineering package may be described as `ENGINEERING_PACKAGE_READY_FOR_INDEPENDENT_REVIEW` when its plans, metrics, runbooks, safety boundaries and executable readiness evaluator are complete and exact-head CI is green.

It may **not** be described as field-validated until representative real-device evidence exists.

It may **not** be described as `READY_FOR_GOVERNED_RIYADH_PILOT_APPROVAL` until required field evidence and external gates are complete.

Even that decision does not authorize activation: final founder/external authorization remains separate.
