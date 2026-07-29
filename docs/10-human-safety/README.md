# ROS Eye — Human Safety Architecture

## Purpose

ROS Eye is the safety-critical human-protection layer of ROS. It turns uncertain road and device signals into an auditable `HumanSafetyCase`, attempts safe contact, escalates ambiguity or silence, supports human takeover, and prevents unsafe resolution.

It is **not** a medical diagnostic system, legal fault engine, autonomous dispatch authority, autonomous severity-downgrade service, or autonomous road reopening controller.

## Safety objective

When information is incomplete, contradictory, delayed, duplicated, malicious, or unavailable, ROS Eye must move toward a safer state: human review, escalation, transfer, monitoring, or blocked resolution. It must never convert uncertainty into silent reassurance.

## System context

```text
Phones / vehicles / people / operators / infrastructure simulators
                         |
                 Signal ingestion ports
                         |
              provenance + anti-replay gate
                         |
             HumanSafetyCase application layer
               /          |            \
      contact protocol  safety fusion  evidence metadata
             |              |               |
     simulated channels  recommendation   restricted store ports
               \          |             /
                 command-center workflow
                         |
              human authority + audit log
```

## Trust boundaries

1. **Untrusted edge:** device, vehicle, person, camera metadata, and future partner signals.
2. **Ingestion boundary:** schema validation, provenance, replay protection, clock-skew checks, rate limiting, and quarantine.
3. **Safety domain boundary:** state machine, deadlines, authority invariants, and fail-closed rules.
4. **Restricted data boundary:** precise location, contact identifiers, structured safety indicators, and evidence references.
5. **Human authority boundary:** operator takeover, supervisor/safety-lead authorization, transfer, and high-risk resolution.
6. **External integration boundary:** all emergency, medical, legal, and government actions remain simulations until separately approved.

## HumanSafetyCase lifecycle

`UNKNOWN → CONTACT_PENDING → CONTACTING → RESPONDED | NO_RESPONSE | UNREACHABLE → HUMAN_REVIEW → ESCALATED → TRANSFERRED → MONITORED → RESOLVED`

Alternative safety transitions are allowed only when they increase safety, such as direct `UNKNOWN → ESCALATED` for credible high-risk evidence or `MONITORED → HUMAN_REVIEW` when conditions deteriorate.

## Non-negotiable invariants

- No S3/S4 case is resolved without recorded supervisor or safety-lead authorization.
- Missing, conflicting, or ambiguous evidence cannot reduce severity or permit resolution.
- Connectivity loss blocks resolution and escalates the case.
- Unhealthy critical dependencies block safety-critical acknowledgement and resolution.
- Contact retries are bounded and idempotent.
- Operator takeover suppresses conflicting automation.
- Every state change records actor, role, reason, trace ID, case version, and timestamp.
- General telemetry excludes raw conversation text, phone numbers, medical narratives, precise coordinates, evidence bytes, tokens, and credentials.
- Domain and application contracts do not expose vendor SDK types.

## Responsibility boundaries

| Capability | Machine authority | Human authority |
|---|---|---|
| Validate schema/provenance | validate, reject, quarantine | review exceptions |
| Start approved contact sequence | yes, within bounded policy | pause/take over |
| Record structured indicators | yes | correct with reason and audit |
| Recommend severity/review | yes, explainable recommendation only | approve, escalate, or override upward |
| Downgrade S3/S4 | no | supervisor/safety lead only |
| Resolve high-risk case | no | supervisor/safety lead only |
| Dispatch real authority | no | external approved process only |
| Diagnose or prescribe | no | outside ROS authority |

## Downstream contract handoff

- #29 consumes lifecycle, indicators, channel, consent, and audit contracts.
- #30 consumes signal envelope, provenance, integrity, and classification contracts.
- #31 implements persistent sessions, timers, retries, recovery, and takeover.
- #32 produces explainable recommendations but cannot bypass authority invariants.
- #33 renders deadlines, uncertainty, authority, degraded states, and audit history.
- #34 enforces classification, purpose, access, retention, masking, and human oversight.
- #35 proves the complete safety case through deterministic E2E, red-team, failure, and recovery evidence.

## Merge boundary

This issue provides architecture, contracts, and deterministic contract/state-machine tests only. Runtime expansion remains blocked until engineering gates #19–#22 are merged and verified.
