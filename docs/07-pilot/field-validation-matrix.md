# Field Validation Matrix

Status: **PLAN / EVIDENCE TEMPLATE — REAL-DEVICE EXECUTION NOT YET CLAIMED**

The matrix below defines the minimum representative evidence to collect before ROS can be considered for a governed Riyadh pilot. A checked/defined row is not proof of execution; execution evidence must identify the exact physical device, OS/build, ROS candidate SHA, scenario and result.

## 1. Device coverage dimensions

### Mobile operating systems

- Android: at least one currently supported low/mid-tier device and one flagship-class device selected by the approved field team.
- iOS: at least two approved representative supported-device classes.
- Device selection must be recorded before execution; this document intentionally does not invent specific production device models.

### Runtime conditions

| Scenario | Required observation | Safe expectation | Evidence required |
|---|---|---|---|
| Fresh install/session | login/session, location permission, event flow | no self-attested privilege/scope | device log + trace + screen evidence |
| Process kill/restart | queued action/recovery | no duplicate logical action | before/after operation IDs + server evidence |
| Device reboot | recovery of approved queued state | no duplicate logical action; stale state revalidated | reboot timestamp + queue/server evidence |
| Offline creation | local queue behavior | no fabricated delivery confirmation | offline state + queue ID + later reconciliation |
| Network reconnect | retry/reconciliation | idempotent exactly-one logical outcome | request/idempotency evidence |
| High latency | UI/operator state | visible degraded/stale state, no unsafe silent continuation | latency conditions + UI/state trace |
| Packet loss/intermittency | retry/backoff | bounded retries; no duplicate action | network profile + traces |
| Clock skew | timestamp/freshness gates | stale/future trust inputs rejected | device/server clock offset evidence |
| Low battery/power saver | background behavior | loss of background execution becomes visible/degraded | battery state + lifecycle trace |
| Thermal/background restriction | service suspension/recovery | no hidden success assumption | OS lifecycle evidence |

## 2. Location/GPS degradation

Execute controlled scenarios representing:

- clear-sky high-quality fix;
- low-accuracy fix;
- urban-canyon-like multipath;
- tunnel/indoor loss of GNSS;
- stale last-known location;
- abrupt location jump/spoof-like anomaly using a simulator/test harness only;
- delayed location recovery.

Required safe properties:

- ROS must not silently increase location confidence;
- stale/low-quality location must be marked as degraded/uncertain;
- correlation that cannot be justified must ABSTAIN or require human review;
- no S3/S4 human-authority boundary may be bypassed because of a location source;
- a raw location source never becomes autonomous operational authority.

## 3. Connectivity degradation

Test profiles should cover, where the approved lab/field setup supports them:

- Wi-Fi → cellular transition;
- cellular → no network;
- no network → cellular recovery;
- high RTT;
- packet loss;
- DNS/dependency failure simulation;
- server unavailable;
- Redis/PostgreSQL dependency degradation where reproduced safely in test infrastructure.

Mandatory invariants:

- no duplicate logical action;
- no unsafe stale-state action;
- no false “externally dispatched” state;
- failed external trust/replay checks fail closed;
- queued items expose retry/reconciliation state.

## 4. Camera / edge validation boundary

Current field package permits **simulated or prerecorded controlled camera/edge inputs only**.

A production camera program requires separate approval covering ownership, lawful basis, privacy, retention, security, geography and integration contract. No camera result alone may autonomously control S3/S4 or road authority.

## 5. Accessibility and multilingual matrix

Critical flows to validate:

1. authenticate / restore session;
2. view active safety state;
3. submit/confirm an incident report in approved test mode;
4. understand offline/degraded state;
5. understand uncertainty/ABSTAIN state;
6. receive/understand operator or safety guidance;
7. cancel/exit a pending user-side action where applicable;
8. reach help/accessibility support path.

Languages:

- Arabic — primary; complete RTL verification;
- English;
- Urdu.

Accessibility dimensions:

| Dimension | Required validation |
|---|---|
| Screen reader | labels, order, live-region/status announcements, actionable controls |
| Dynamic/text scaling | critical content remains visible and operable |
| RTL | correct navigation/order/alignment without semantic inversion |
| Reduced motion | no critical information depends on animation |
| Color independence | safety state not communicated by color alone |
| Focus/keyboard where applicable | deterministic focus order and visible focus |
| Low-attention/one-hand | critical action path remains short; no driving-distraction pattern |
| Hands-free alternative | when interaction could occur around driving, use approved non-manual path or defer interaction safely |

## 6. Operator workstation matrix

Validate at minimum:

- normal queue;
- high queue/backlog;
- overdue S3/S4 item;
- no-response/unreachable contact;
- stale dashboard data;
- dependency degradation;
- evidence checksum/quarantine warning;
- supervisor takeover;
- kill-switch activation;
- recovery after operator workstation/session restart.

Safe expectation: critical/overdue cases remain visible and cannot be silently downgraded by filtering, stale data or low-confidence automation.

## 7. Evidence record for every executed row

Each actual field/device result must include:

- scenario ID;
- exact ROS head SHA/build ID;
- device identifier that avoids unnecessary personal identity;
- hardware class/model and OS version;
- app/build version;
- network/location test profile;
- start/end timestamps and trusted time source;
- expected safe state;
- observed state;
- PASS/FAIL/ABSTAIN;
- relevant operation/event/trace IDs;
- screenshots/logs only when minimum necessary and approved;
- reviewer;
- unresolved defect/hazard reference.

## 8. Current status

`DEFINED_NOT_EXECUTED` for representative physical-device evidence.

No statement in this document should be read as proof that a particular phone, public road, participant, agency or production sensor has already been tested.
