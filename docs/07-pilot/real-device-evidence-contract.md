# ROS Real-Device Evidence Contract v1

## Purpose

This contract defines how representative Android and iOS field-lab evidence is collected before a governed Riyadh pilot can advance beyond engineering-package review.

It is an **evidence intake protocol**, not an activation mechanism. A valid bundle can satisfy only the real-device subset of `PilotFieldEvidence`. It cannot approve geography, dates, participants, data sharing, partner connectivity, public-road exposure, emergency dispatch, camera access, vehicle actuation, or any S3/S4 autonomous authority.

The executable validator is `apps/api/src/pilot/real-device-evidence.ts` and accepts only schema `ros-real-device-evidence/v1`.

## Mandatory safety boundary

All sessions represented by this contract must run as `CONTROLLED_FIELD_LAB` evidence collection. Until separate founder and external approvals exist:

- ROS remains `SHADOW_ONLY` / recommendation-only;
- uncertain signals must `ABSTAIN`;
- S3/S4 decisions remain human-controlled;
- no real emergency, traffic, police, ambulance, insurer or towing dispatch is permitted;
- no live public camera feed is permitted;
- no vehicle actuation is permitted;
- no clinical diagnosis or legal-fault automation is permitted;
- no public-road participant exposure may be inferred from a PASS result.

A field engineer must stop the session if any of these boundaries cannot be maintained.

## Candidate binding

Every session contains the exact 40-character Git candidate SHA under test. All sessions in one bundle must bind to the **same** candidate SHA. Mixed candidate heads are rejected.

The installed application build must also be identified by a SHA-256 digest. Device evidence produced by an unidentifiable build is not acceptable evidence.

## Minimum representative coverage

A bundle cannot PASS unless it contains, at minimum:

1. one Android session with a passing critical flow;
2. one iOS session with a passing critical flow;
3. a passing GPS-degradation safe-state scenario;
4. a passing network-loss safe-state scenario;
5. a passing restart/reconnect safe-state scenario;
6. a passing Android TalkBack screen-reader critical flow;
7. a passing iOS VoiceOver screen-reader critical flow.

Coverage may be distributed across multiple controlled field-lab sessions as long as every session targets the same candidate SHA.

This is the minimum evidence contract, not a claim that two devices alone are representative of the final fleet. The final pilot device matrix remains governed by `field-validation-matrix.md` and external/pilot approvals.

## Scenario semantics

### `CRITICAL_FLOW`

Exercise the safety-critical user journey on the physical device, including the applicable offline/online transitions, operator-visible state and prevention of duplicate logical actions. The exact flow used must be identified in the evidence file(s).

### `GPS_DEGRADATION`

Introduce a controlled loss/degradation of reliable location input. The expected safe result is explicit degraded/uncertain state, no invented precision and no unsafe autonomous action.

### `NETWORK_LOSS`

Introduce controlled loss of connectivity. Offline work must remain durable where designed, reconnect must not create duplicate logical actions, and stale data must not authorize an unsafe action.

### `RESTART_RECONNECT`

Restart the application/device process during a controlled in-progress flow. Recovery must preserve the defined safe state and must not repeat a logical operation merely because the client restarted.

### `SCREEN_READER`

Execute the critical flow using the native platform screen reader: TalkBack on Android and VoiceOver on iOS. The test must cover focus order, actionable labels, status/error announcement and completion without an inaccessible critical control.

## Evidence files

Every scenario must reference at least one non-empty evidence file. Each file entry contains:

- a safe repository/package-relative evidence path;
- exact byte size;
- lowercase SHA-256 digest of the captured file.

The validator rejects empty files, malformed digests, absolute/traversal paths, unknown fields, duplicate session IDs and duplicate case IDs.

Recommended evidence forms are minimal diagnostic JSON, redacted structured logs, screenshots where needed for accessibility proof, and short screen recordings only when they materially prove a visual/focus behavior.

## Data minimization

`privacyDataMinimized=true` is mandatory for a passing scenario. Evidence collection must avoid or redact information not required to prove the scenario, including unrelated people, license plates, phone numbers, precise home/work locations, unrelated audio, contact books, production credentials and third-party identifiers.

Do not capture a live public-road camera feed or real bystander data merely to satisfy this evidence contract. Synthetic or controlled-lab stimuli are preferred before any separately approved field program.

If required proof cannot be collected without broader personal-data processing, stop and escalate for privacy/data-sharing approval before collection.

## Hard NO-GO evidence conditions

The evidence evaluation returns `NO_GO` when any of the following is present:

- any recorded scenario outcome is `FAIL`;
- any scenario violates data minimization;
- one or more duplicate logical actions are observed;
- one or more unsafe stale-state actions are observed;
- mandatory Android/iOS or accessibility coverage is missing;
- mandatory degradation/recovery coverage is missing;
- evidence integrity metadata is malformed or incomplete.

The validator fails closed on malformed input instead of normalizing it into a passing result.

## Separation from remaining pilot gates

A PASS from `evaluateRealDeviceEvidence()` may support only these `PilotFieldEvidence` inputs:

- `representativeRealDeviceCriticalFlowsPassed`;
- `gpsDegradationSafeStateVerified`;
- `networkLossSafeStateVerified`;
- `restartReconnectSafeStateVerified`;
- `screenReaderCriticalFlowsPassed`;
- `evidenceIntegrityVerified`;
- observed duplicate/stale-action counters.

It deliberately does **not** self-attest:

- operator-overload safe state;
- kill-switch execution;
- rollback execution;
- S3/S4 human-review staffing;
- unresolved hazard count;
- independent safety/security approval;
- privacy/legal approval;
- actual geography/date/participants;
- partner sandbox approval.

Those remain independent inputs to the existing fail-closed pilot readiness evaluator.

## Evidence review procedure

Before accepting a bundle:

1. identify the candidate head and application-build digest;
2. verify each referenced evidence file byte size and SHA-256 independently;
3. confirm the device model, OS, locale and native screen-reader mode;
4. confirm the scenario occurred in a controlled field-lab boundary;
5. review any recorded failure, duplicate action or stale-state action as a blocking finding;
6. run the executable parser/evaluator against the bundle;
7. store the bundle digest and review disposition with the pilot evidence package;
8. never translate a PASS into pilot activation automatically.

## Founder escalation

Founder/external approval is required before this protocol is expanded to any of the following:

- real public-road participants;
- a named Riyadh geography/date window;
- real emergency/traffic/partner endpoint use;
- material participant or third-party personal-data collection;
- live camera programs;
- vehicle actuation;
- acceptance of material residual safety/privacy risk.
