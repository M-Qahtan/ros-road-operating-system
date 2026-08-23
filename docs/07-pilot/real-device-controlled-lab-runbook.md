# ROS RC1 Real-Device Controlled Lab Runbook

## Mission

Produce byte-verified Android and iOS evidence for the exact ROS candidate under test within a controlled field-lab boundary. This procedure validates device behavior and accessibility; it does not authorize public-road operation or external emergency action.

## Exact candidate binding

There is deliberately no hard-coded moving `main` SHA in this runbook.

Every executed build and every evidence bundle must be bound to the exact reviewed Git head supplied to the validator as `<expected-candidate-head-sha>`. The trusted expected SHA must come from the approved review/release record outside the evidence bundle. The bundle cannot choose its own trusted candidate identity.

If the reviewed candidate head changes for any reason, all code-bound field evidence for the prior head is stale and must be recollected or explicitly dispositioned by the review authority. Never relabel old device evidence as belonging to a newer candidate.

## Mandatory device and language matrix

The final evidence bundle must contain, at minimum:

- representative Android critical flow;
- representative iOS critical flow;
- Arabic critical flow (`ar-*`);
- English critical flow (`en-*`);
- Urdu critical flow (`ur-*`);
- Android TalkBack critical flow;
- iOS VoiceOver critical flow;
- GPS degradation safe-state scenario;
- network-loss/offline scenario;
- restart/reconnect scenario.

A locale counts only when its critical-flow scenario is `PASS`, `privacyDataMinimized=true`, `duplicateLogicalActionsObserved=0`, and `staleUnsafeActionsObserved=0`.

## Required scenario assertions

For each critical path, prove the following where applicable:

1. consent/language selection remains understandable and actionable;
2. Arabic RTL layout preserves the safety action order and does not invert meaning;
3. screen-reader focus order exposes the critical action, status, privacy and takeover semantics;
4. loss of GNSS accuracy cannot silently promote a location-derived conclusion;
5. network loss preserves the bounded offline queue without duplicate logical action;
6. restart/reconnect restores pending state and does not silently repeat a safety action;
7. stale state blocks unsafe critical actions;
8. no real emergency dispatch, live camera ingestion, vehicle actuation or autonomous S3/S4 action occurs.

## Evidence binding

Every session must use the existing `ros-real-device-evidence/v1` contract and include:

- exact candidate Git SHA;
- device platform/model/OS version;
- application build SHA-256;
- locale;
- screen-reader mode;
- trusted session start/completion timestamps;
- scenario result and counters;
- evidence file path, byte size and lowercase SHA-256.

The verifier independently reads every evidence file under the supplied evidence root, rejects symlinks/path escape, verifies byte size + SHA-256 and compares every session to the trusted expected Git SHA supplied outside the bundle.

## Privacy boundary

Evidence should contain structured test outcomes rather than raw personal content. Do not capture or archive real names, phone numbers, medical narratives, personal trip history, production credentials, unrestricted access tokens or unredacted incident evidence.

Use synthetic or explicitly approved lab data only.

## Validation command

From the repository root after building the exact candidate:

```bash
pnpm --filter @ros/api validate:real-device-evidence -- <bundle.json> <evidence-root> <expected-candidate-head-sha>
```

Exit behavior:

- `0`: controlled-lab evidence gate PASS;
- `2`: valid evidence package but one or more required gates/coverage items are NO-GO;
- `1`: malformed input, integrity failure or verifier execution error.

## Hard NO-GO conditions

Any of the following is a hard NO-GO:

- missing Android or iOS critical flow;
- missing Arabic, English or Urdu passing critical flow;
- missing TalkBack or VoiceOver passing critical flow;
- missing GPS/network/restart-reconnect safe-state coverage;
- any duplicate logical action;
- any stale-state unsafe action;
- any failed scenario or data-minimization violation;
- mismatched/unverified candidate head;
- evidence byte/hash mismatch;
- mixed candidate heads across sessions;
- evidence collected for a superseded code head and relabeled without recollection;
- any real emergency dispatch, public-road autonomous intervention, live camera program or vehicle actuation.

## Handoff

A PASS here satisfies only the real-device field-evidence subset. It must later be combined with the other pilot readiness gates and independent review. It never sets `activationAuthorized=true` and does not authorize a Riyadh public-road pilot by itself.
