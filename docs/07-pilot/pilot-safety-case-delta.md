# Pilot Safety Case Delta and Residual Risk Register

Status: **PRE-PILOT ENGINEERING DELTA — FIELD RESIDUAL RISK NOT YET ACCEPTED**

## 1. Purpose

The existing ROS engineering safety case is dominated by deterministic simulation, exact-head CI, durable runtime/integration controls and fail-closed authority boundaries. A controlled Riyadh pilot introduces additional field-specific uncertainty that cannot be closed by software tests alone.

This delta records those new/expanded hazards, the required safe state, the evidence needed to close them, and the current residual-risk status.

## 2. Field hazard delta

| Hazard / field uncertainty | Potential consequence | Required control / safe state | Evidence required before governed pilot approval | Current status |
|---|---|---|---|---|
| GNSS loss / multipath / stale location | wrong event correlation/location confidence | mark degraded, lower confidence, ABSTAIN/human confirmation | representative device/location-degradation evidence | PENDING FIELD EVIDENCE |
| Network loss / reconnect | duplicate logical action or false delivery state | durable idempotency/reconciliation; never fabricate external acknowledgement | device network-loss/reconnect evidence + server traces | PENDING FIELD EVIDENCE |
| Device process kill/reboot | queue duplication/lost state | stable operation IDs; restart reconciliation; stale-state revalidation | representative device restart/reboot evidence | PENDING FIELD EVIDENCE |
| Clock skew | freshness/replay/trust failure | fail closed on stale/future trust inputs; approved time source | device/server skew matrix | PENDING FIELD EVIDENCE |
| Battery/power-management suspension | silent loss of background processing | visible degraded state; no hidden success assumption | low-battery/power-saver evidence | PENDING FIELD EVIDENCE |
| Operator overload | unreviewed critical case / unsafe queue pressure | preserve S3/S4 visibility; stop nonessential pilot work; kill if review cannot be maintained | controlled operator-load rehearsal | PENDING FIELD EVIDENCE |
| Screen-reader/RTL failure | inaccessible critical safety state | critical path must remain perceivable/operable | real-device Arabic/English/Urdu accessibility report | PENDING FIELD EVIDENCE |
| Kill-switch unavailable | inability to stop unsafe pilot behavior | independent stop path; fail toward less authority | exact-environment kill-switch test | PENDING FIELD EVIDENCE |
| Rollback failure | prolonged unsafe/degraded candidate state | preserve evidence; restore accepted candidate/config; reconcile durable state | exact-environment rollback test | PENDING FIELD EVIDENCE |
| Evidence integrity failure | inability to reconstruct/defend decisions | quarantine/fail closed; stop affected scenario | field evidence integrity/reconstruction exercise | PENDING FIELD EVIDENCE |
| Real partner outage or trust failure | stale/false agency state | fail closed/degraded; no fabricated dispatch | approved partner-sandbox outage/retry evidence | EXTERNAL GATE PENDING |
| Scope/privacy error with real participants | unauthorized collection/sharing | minimum necessary; approved participant/data-sharing protocol | privacy/legal approval and field audit | EXTERNAL GATE PENDING |
| Unauthorized camera/vehicle capability | surveillance or physical intervention risk | capability disabled; stop/incident if activated | separate founder/regulatory approval before any such program | FORBIDDEN |
| Automation substitutes for S3/S4 reviewer | critical safety authority bypass | human authority mandatory; stop if unavailable | staffing/takeover rehearsal | PENDING FIELD EVIDENCE |

## 3. Existing engineering controls carried forward

The pilot package inherits, but must not overstate, current engineering evidence for:

- persistent RoadEvent tenant/purpose isolation;
- durable Outbox scope propagation;
- exactly-one logical runtime/partner operation under tested retry/restart paths;
- callback replay protection;
- OIDC/JWS trust boundaries;
- S3/S4 human-review governance;
- ABSTAIN-on-uncertainty policy;
- evidence/audit and fail-closed design;
- deterministic failure-mode testing.

These controls reduce risk but do not substitute for representative field evidence.

## 4. Residual-risk acceptance rules

- Any unresolved **P0/P1** hazard → `NO_GO`.
- Material field residual risk cannot be accepted by CI, the readiness evaluator or an engineering agent.
- Any residual risk requiring a change to geography, participants, data sharing, human-authority boundary, real external integration, live cameras or vehicle actuation requires founder/external decision.
- A reviewer may recommend; only the authorized governance path may accept the residual risk.

## 5. Current safety-case conclusion

Current defensible statement:

`ENGINEERING CONTROLS DEFINED; FIELD SAFETY CASE NOT YET CLOSED`

The package is suitable for exact-head engineering verification and independent pre-field review. It is **not** evidence that a controlled Riyadh pilot is approved or safe to activate today.
