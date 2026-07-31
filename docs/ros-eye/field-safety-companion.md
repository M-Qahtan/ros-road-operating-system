# ROS Eye Field Safety Companion and Device Simulator

## Purpose

This implementation delivers issue #36 as a mobile-first reference companion and deterministic device simulator. It lets a person participate safely in ROS Eye contact, provide structured replies, see consent and sharing state, survive offline/restart conditions, and observe operator takeover.

It is not an approved public emergency application and does not claim real connection to ambulance, traffic, police, or any government system.

## Safety and privacy invariants

1. The critical interaction uses structured options only. Free text and medical narrative are outside the contract.
2. No precise latitude or longitude is displayed, persisted by the companion state, or included in general telemetry.
3. Device sharing contains classified metadata only: network, battery, location quality, motion category, and clock-skew bucket—not raw sensor streams.
4. Consent is explicit. Declining consent stops structured collection and moves the flow to human review.
5. Offline operations remain bounded, expire after the local retention window, and use stable idempotency keys.
6. Restart/reconnect rehydrates consent, contact status, pending operations, and acknowledged keys without duplicating logical replies.
7. Untrusted device time blocks device-metadata sharing.
8. `HELP_REQUESTED` and `CANNOT_SPEAK` move toward operator takeover; they do not claim or execute real dispatch.
9. Simulation labels are persistent and unambiguous.
10. The server denies browser geolocation, camera, and microphone permissions in this simulation build.

## User flow

- Receive a simulated HumanSafetyCase/session.
- Review the simulation and privacy notice.
- Grant or decline consent.
- Select Arabic or English.
- Answer with bounded structured options.
- Continue safely when offline; queued replies are retained locally.
- Reconnect and deliver exactly once.
- Observe explicit operator takeover.
- See what data categories are shared and why.

## Device simulator

The simulator covers:

- network: online, degraded, offline;
- battery: normal, low, critical;
- motion: stable, hard brake, possible impact, possible rollover;
- location quality: restricted precise availability, approximate, unavailable;
- bounded or untrusted clock skew;
- app restart and local state recovery.

The simulation never grants raw device input autonomous authority.

## Accessibility evidence

- Arabic RTL first.
- Semantic main, sections, fieldset, legend, labels, alerts, and status regions.
- Large touch targets and one-column mobile critical path.
- Screen-reader-compatible controls.
- High contrast and non-color-only status labels.
- Reduced-motion mode.
- One-hand and low-attention layout.

## Acceptance traceability

| Issue #36 criterion | Evidence |
|---|---|
| Arabic RTL, large text, one-hand use | mobile layout, large controls, responsive CSS |
| Screen reader critical path | semantic form/fieldset/legend/labels and tests |
| Offline/restart/reconnect | persistence and exactly-once delivery tests |
| Duplicate callback protection | acknowledged idempotency ledger and simulated gateway receipts |
| Explicit data sharing | sharing panel and privacy summary |
| No raw sensitive logging | telemetry allowlist tests |
| Device degradation visible | simulator controls and structured state |
| No false government/emergency claim | persistent simulation warning and negative-claim tests |
| Response/no-response/fallback/takeover | structured reply, offline, help request and takeover workflow tests |

## Production boundary

A future production client must replace the browser-local storage and simulated gateway with platform-encrypted storage, device attestation, trusted identity, approved sensor permissions, approved communication providers, and the privacy/security controls established under issue #34. This reference does not make those approvals or integrations real.
