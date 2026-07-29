# ROS Eye human contact protocol

## Status and boundary

This specification implements issue #29 as a vendor-neutral, Arabic-first contact protocol. It is not clinical guidance, a diagnosis, treatment advice, legal advice, a guarantee of emergency response, or a real telephony/emergency-dispatch integration. All Arabic prompt text is a governance placeholder and must remain `PLACEHOLDER_NOT_APPROVED` until clinical, legal, privacy, accessibility, linguistic, and governmental review is recorded.

## Safety objective

The protocol reassures a person, requests consent, establishes language and accessibility needs, collects only structured safety indicators, detects silence/interruption/contradiction, and transfers attention upward. Machines may initiate contact, apply bounded retries, and escalate. They may not lower severity, resolve a safety case, diagnose, prescribe, determine legal fault, or claim that help is guaranteed.

## State model

```text
CREATED
  -> CONSENT_PENDING
  -> LANGUAGE_SELECTION
  -> CONTACTING
  -> AWAITING_RESPONSE
       -> PARTIAL_RESPONSE -> AWAITING_RESPONSE | RESPONSE_CONFIRMED
       -> RESPONSE_CONFIRMED -> OPERATOR_TAKEOVER | HUMAN_REVIEW | ESCALATED | COMPLETED
       -> DISCONNECTED | NO_RESPONSE -> bounded CONTACTING retry | OPERATOR_TAKEOVER | HUMAN_REVIEW | ESCALATED
       -> OPERATOR_TAKEOVER | HUMAN_REVIEW | ESCALATED
```

`UNREACHABLE` never silently becomes safe. `COMPLETED` may be re-opened only toward `HUMAN_REVIEW` or `ESCALATED`. Completion requires confirmed identity confidence and does not resolve the parent `HumanSafetyCase`.

## Deterministic deadlines and retry policy

- A response deadline is created when entering `AWAITING_RESPONSE`.
- Silence and interruption produce a human-action requirement and a bounded retry deadline.
- Automated contact attempts are capped at three.
- Retry exhaustion, failed channel health, or unavailable accessibility paths fail toward `HUMAN_REVIEW` or `ESCALATED`.
- Runtime adapters must add bounded jitter, idempotency, per-session rate limits, cancellation after operator takeover, and suppression of duplicate notifications.

## Content separation

User-facing content is short, reassuring, and non-diagnostic. Operator facts use stable codes and structured indicators. General logs and metrics must not contain free text, medical narratives, phone numbers, precise location, raw audio, raw replay/idempotency tokens, or prompt responses beyond approved codes.

## Prompt contract

Every prompt carries:

- stable prompt ID and version;
- locale and purpose;
- approved structured response options;
- data classification and retention class;
- escalation effect;
- accessibility metadata;
- governance state.

The Arabic catalog in contracts is intentionally placeholder-only. Production wording requires governance approval and immutable evidence linking the approved text, reviewer roles, jurisdiction, version, and effective period.

## Accessibility invariants

Each critical prompt requires screen-reader semantics, simple language, large controls, hands-free support, visual and audio alternatives, and no reliance on color or sound alone. Failure to provide the required modality is a safety-path failure, not a cosmetic degradation.

## Reply integrity

Replies are structured envelopes with session, prompt version, timestamp, selected option codes, and an idempotency key. Unknown fields and free text are quarantined. Contradictory options route to human review. Atomic consume is required before processing; duplicates are quarantined and registry failure routes to human review.

## Operator takeover

Operator takeover is explicit, audit-recorded, and suppresses automated channel actions. The operator receives structured facts, current deadlines, channel/accessibility status, and reason codes; the operator does not receive unnecessary sensitive free text.

## Required audit evidence

- protocol, prompt, and accessibility policy versions;
- case/session/version and trace identifiers without direct personal information;
- actor and authorized role;
- state transition, deadline, attempt count, channel health, accessibility status;
- prompt ID/version/purpose, structured reply codes, idempotency consume result;
- safe-state disposition and limitations;
- candidate commit SHA and test execution ID.
