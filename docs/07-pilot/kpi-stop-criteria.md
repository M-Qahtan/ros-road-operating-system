# Pilot KPI and Stop-Criteria Specification

Status: **MEASUREMENT CONTRACT — NUMERIC PERFORMANCE TARGETS REQUIRE PILOT APPROVAL**

This specification defines how ROS pilot metrics must be measured before an approved pilot starts. It intentionally avoids inventing field-performance targets that have not yet been approved or baselined on representative devices.

## 1. Measurement principles

- numerator and denominator must be defined before data collection;
- every metric must identify the exact candidate SHA and scenario population;
- abstentions and failures remain in the denominator where applicable;
- no retrospective denominator editing to improve results;
- separate simulation, device-in-loop and real-pilot populations;
- report distribution/percentiles where averages can hide tail risk;
- safety invariants use zero-tolerance stop criteria where a single violation is unacceptable.

## 2. Core pilot KPIs

| KPI | Definition | Required dimensions | Current target status |
|---|---|---|---|
| Detection latency | trusted event-observation time → ROS event-detection time | source type, network condition, device class, severity | BASELINE / target to be approved |
| Human-review latency | S3/S4 review-required time → qualified reviewer acquisition | severity, shift/load, outage state | BASELINE / target to be approved |
| Contact success | eligible contact attempts reaching defined successful outcome / eligible attempts | channel, retry tier, network | BASELINE / target to be approved |
| Operator takeover | cases requiring human takeover / evaluated cases | trigger reason, severity, uncertainty | BASELINE |
| False negative rate | known required positive/safety escalation cases missed / known required positive cases | scenario class, source quality | target requires safety approval; every confirmed miss reviewed |
| False positive rate | false positive alerts / evaluated negative cases | scenario class, source quality | target requires operations/safety approval |
| ABSTAIN rate | explicit abstentions / AI-evaluated cases | uncertainty reason, source quality | diagnostic, not inherently bad |
| Duplicate suppression | duplicate/replayed attempts suppressed / duplicate/replayed attempts observed | source, retry/restart path | baseline; any logical duplicate execution is a hard stop |
| Stale-state rejection | unsafe stale actions rejected / stale unsafe-action attempts | subsystem/path | baseline; any unsafe stale-state execution is a hard stop |
| RoadEvent restoration latency | restoration workflow start → approved restored state | scenario/road impact; human authorization | BASELINE / target to be approved |
| Evidence completeness | required evidence fields present and integrity-valid / expected evidence records | scenario/build | missing integrity-critical evidence is a stop condition |
| Accessibility critical-flow pass | passed required flows / executed required flows | language, device, screen reader | all required representative flows must pass before approval |
| Kill-switch recovery | stop command → governed stopped state, and recovery path evidence | subsystem/test condition | must be demonstrated before approval |
| Operator workload | active/overdue critical queue, handling time, takeover count | shift/load profile | baseline; overload safe state must be demonstrated |

## 3. Zero-tolerance hard-stop metrics

The following are not “performance targets”; they are safety invariants for pilot consideration:

- `unresolvedP0P1Hazards > 0` → **NO-GO**;
- `duplicateLogicalActionsObserved > 0` → **STOP / NO-GO**;
- `staleStateUnsafeActionsObserved > 0` → **STOP / NO-GO**;
- S3/S4 human authority unavailable → **STOP / NO-GO**;
- SHADOW_ONLY boundary disabled without a separate approved phase change → **STOP / NO-GO**;
- ABSTAIN-on-uncertainty disabled → **STOP / NO-GO**;
- evidence integrity failure affecting decision reconstruction → **STOP / NO-GO**;
- kill switch unavailable or untested before real pilot approval → **NO-GO**;
- public-road autonomous intervention enabled → **STOP / NO-GO**;
- unauthorized real emergency dispatch → **STOP / INCIDENT**;
- unauthorized live-camera program → **STOP / INCIDENT**;
- unauthorized vehicle actuation → **STOP / INCIDENT**;
- clinical diagnosis or legal-fault automation enabled → **STOP / NO-GO**.

## 4. Performance threshold governance

Latency, false-positive, false-negative, workload and contact-success numeric thresholds must be approved in the pilot measurement plan after:

1. representative lab/device-in-loop baseline exists;
2. measurement method is independently reviewed;
3. partner/external SLA constraints are known where relevant;
4. sample-size limitations are documented;
5. the threshold does not weaken a hard safety invariant.

Until then, CI must not encode arbitrary field-performance numbers as if they were approved policy.

## 5. Required reporting slices

Report KPIs by relevant strata instead of a single global number:

- severity class;
- source type/quality;
- device/OS class;
- Arabic/English/Urdu;
- accessibility mode;
- network condition;
- GPS quality;
- normal vs degraded dependency state;
- operator workload band;
- new event vs retry/restart/reconnect;
- shadow vs any later separately approved canary phase.

## 6. Evidence integrity

Every KPI report must reference:

- exact candidate SHA;
- metric-definition version;
- scenario population/denominator;
- data exclusions with reason;
- timestamp/time source;
- collection pipeline version;
- raw evidence manifest/checksum location where authorized;
- reviewer and review date.

A KPI summary without reproducible denominator and candidate identity is not acceptance evidence.
