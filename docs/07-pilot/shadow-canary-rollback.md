# Shadow, Canary, Rollback and Kill-Switch Protocol

Status: **CONTROL PLAN — NO CANARY OR PUBLIC-ROAD AUTHORITY GRANTED**

## 1. Default mode

The default and currently authorized engineering posture is:

- `SHADOW_ONLY` / `RECOMMENDATION_ONLY`;
- ABSTAIN on uncertainty;
- S3/S4 require human review;
- no automatic emergency dispatch;
- no autonomous road closure/reopening;
- no vehicle actuation;
- no production camera program;
- no clinical/legal automation.

A green engineering build does not change that mode.

## 2. Phase model

### Phase 0 — deterministic lab/simulation

Allowed:
- synthetic/prerecorded controlled inputs;
- test identities/data;
- dependency failure injection;
- device simulators;
- replay/restart/reconnect tests.

Forbidden:
- public-road authority;
- real dispatch;
- live production camera/vehicle control.

### Phase 1 — controlled device/field rehearsal

Requires approved controlled environment and evidence plan. ROS remains SHADOW_ONLY. No real emergency action or public-road intervention is allowed.

### Phase 2 — governed shadow pilot

May be considered only after field and external readiness gates pass and founder/external approval names the exact geography, window, participants, partner scopes and rollback authority.

ROS recommendations may be observed and compared against human/ground truth, but do not autonomously execute public-safety actions.

### Phase 3 — canary consideration

This document does **not** authorize canary operation. Canary requires a separate decision after Phase 2 evidence is independently reviewed. Scope must be narrower than the approved pilot boundary and retain immediate human override/kill capability.

## 3. Kill-switch requirements

Before any real governed pilot approval, the kill switch must have:

- named authorized operators;
- tested access path independent of the primary application UI where practical;
- explicit effect: stop/disable pilot action paths without destroying evidence;
- audit record of who activated it, when and why;
- visible state to operations staff;
- recovery procedure requiring deliberate authorization;
- test evidence on the exact candidate stack/environment.

The kill switch must fail toward **less authority**, not toward autonomous continuation.

## 4. Immediate stop triggers

Stop the rehearsal/pilot immediately on any of the following:

- unresolved or newly discovered P0/P1 safety/security hazard;
- duplicate logical action;
- unsafe action from stale state;
- S3/S4 human-review path unavailable;
- evidence integrity failure that prevents decision reconstruction;
- loss of kill-switch control;
- unapproved scope expansion;
- unauthorized real external dispatch;
- unauthorized production camera access;
- unauthorized vehicle actuation;
- tenant/purpose isolation failure;
- callback/trust bypass or credential compromise;
- repeated dependency degradation with no verified safe state;
- operator overload where critical cases cannot be safely supervised.

## 5. Degraded-state behavior

When a dependency or signal becomes unreliable:

- lower confidence explicitly;
- mark stale/degraded state visibly;
- ABSTAIN where the system cannot justify a safe recommendation;
- preserve S3/S4 human authority;
- queue/reconcile only idempotent actions;
- never fabricate external acknowledgement or dispatch;
- retain evidence of the degradation and recovery.

## 6. Rollback model

Rollback must be defined for configuration, application candidate and pilot operational scope.

Minimum rollback evidence:

1. identify last independently accepted candidate/configuration;
2. stop new pilot actions;
3. preserve in-flight/evidence state;
4. restore the accepted candidate/configuration;
5. reconcile durable queues/idempotency state;
6. verify readiness/health;
7. require human authorization before resuming any governed pilot activity.

Rollback must not erase evidence or silently re-run logical operations.

## 7. Canary constraints if separately authorized later

Any later canary decision must specify:

- exact functionality enabled beyond shadow;
- exact population/geography/time window;
- allowed partner endpoints;
- maximum authority boundary;
- human override path;
- stop metrics;
- rollback target;
- evidence package;
- named approval records.

Anything not explicitly listed remains disabled.

## 8. Authority separation

Software may evaluate whether prerequisite evidence appears complete. Software may not:

- approve its own pilot;
- accept material residual risk for the founder;
- create external legal/privacy authorization;
- convert provider transport success into public-safety authority;
- infer permission to expand scope from prior approvals.

Final activation remains a deliberate founder/external decision outside the readiness evaluator.
