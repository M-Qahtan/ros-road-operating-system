# HumanSafetyCase lifecycle and authority matrix

## Transition specification

| Current | Requested | Preconditions | Owner | Timeout | Audit action | Failure behavior |
|---|---|---|---|---:|---|---|
| UNKNOWN | CONTACT_PENDING | case identity and RoadEvent link validated | SYSTEM | immediate | `human_safety.case_opened` | malformed or replayed input is quarantined |
| UNKNOWN | HUMAN_REVIEW | provenance uncertain, evidence conflicting, or identity ambiguous | SYSTEM | immediate | `human_safety.review_required` | never auto-resolve |
| UNKNOWN | ESCALATED | credible S3/S4 indicators or unavailable critical context | SYSTEM | immediate | `human_safety.escalated` | page human operator |
| CONTACT_PENDING | CONTACTING | approved protocol version and at least one permitted channel | SYSTEM | 5 s target | `human_safety.contact_started` | fallback channel or review |
| CONTACTING | RESPONDED | validated response linked idempotently to active session | SYSTEM | protocol deadline | `human_safety.person_responded` | duplicate ignored; contradiction to review |
| CONTACTING | NO_RESPONSE | response deadline elapsed | SYSTEM | 30 s modeled baseline | `human_safety.no_response` | escalate; bounded retry only |
| CONTACTING | UNREACHABLE | all permitted channels fail or device unavailable | SYSTEM | 30 s modeled baseline | `human_safety.unreachable` | escalate and expose uncertainty |
| CONTACTING | HUMAN_REVIEW | contradictory, partial, inaccessible, or suspicious interaction | SYSTEM/OPERATOR | immediate | `human_safety.contact_review_required` | automation pauses when operator takes over |
| RESPONDED | HUMAN_REVIEW | structured indicators conflict or require judgment | SYSTEM/OPERATOR | immediate | `human_safety.indicators_review_required` | no automatic downgrade |
| RESPONDED | ESCALATED | high-risk indicator, explicit help request, or deteriorating evidence | SYSTEM/OPERATOR | immediate | `human_safety.escalated` | notify simulated workflow only |
| RESPONDED | TRANSFERRED | operator accepts ownership or approved external simulation handoff | OPERATOR | 60 s target | `human_safety.transferred` | retain ownership until acknowledgement |
| NO_RESPONSE | CONTACTING | retry budget and alternative channel remain | SYSTEM | bounded backoff | `human_safety.contact_retried` | retry exhaustion escalates |
| NO_RESPONSE | ESCALATED | deadline or retry budget exhausted | SYSTEM | immediate | `human_safety.no_response_escalated` | human queue required |
| UNREACHABLE | CONTACTING | channel recovered and retry budget remains | SYSTEM | bounded backoff | `human_safety.channel_recovered` | otherwise escalate |
| UNREACHABLE | ESCALATED | channel unavailable past deadline | SYSTEM | immediate | `human_safety.unreachable_escalated` | human queue required |
| HUMAN_REVIEW | ESCALATED | reviewer confirms risk or uncertainty remains material | OPERATOR | queue SLA | `human_safety.review_escalated` | never silently clear |
| HUMAN_REVIEW | TRANSFERRED | operator or safety lead accepts responsibility | OPERATOR/SAFETY_LEAD | queue SLA | `human_safety.review_transferred` | prior owner retains until accepted |
| ESCALATED | TRANSFERRED | authorized human accepts case | OPERATOR/SAFETY_LEAD | P0/P1 SLA | `human_safety.escalation_transferred` | keep escalation active |
| TRANSFERRED | MONITORED | receiving human acknowledges and monitoring plan exists | OPERATOR/SAFETY_LEAD | explicit | `human_safety.monitoring_started` | transfer remains pending |
| MONITORED | HUMAN_REVIEW | stale, contradictory, or deteriorating state | SYSTEM/OPERATOR | immediate | `human_safety.monitoring_review_required` | critical actions disabled on stale data |
| MONITORED | ESCALATED | worsening indicators or missed monitoring deadline | SYSTEM/OPERATOR | immediate | `human_safety.monitoring_escalated` | human queue required |
| MONITORED | RESOLVED | trusted evidence, healthy dependencies, no unresolved deadline; S3/S4 has current human authorization | SUPERVISOR/SAFETY_LEAD for S3/S4 | explicit | `human_safety.resolved` | reject and return to review/escalation |
| RESOLVED | HUMAN_REVIEW | explicit `reactivationCause` for late high-risk signal, contradictory indicator, evidence correction, or dependency-recovery finding | SYSTEM/OPERATOR | immediate | `human_safety.resolved_case_reopened_for_review` | missing cause rejects; prior resolution record remains immutable |
| RESOLVED | ESCALATED | explicit `LATE_HIGH_RISK_SIGNAL` or other approved reactivation cause requiring immediate escalation | SYSTEM/OPERATOR | immediate | `human_safety.resolved_case_escalated` | missing cause rejects; prior authorization is not inherited |

## Post-resolution reactivation policy

`RESOLVED` is immutable as a historical outcome, but it is not allowed to suppress new safety information. A new material signal or correction creates a new case version and a distinct audit event that moves the active lifecycle to `HUMAN_REVIEW` or `ESCALATED` only.

Approved reactivation causes are:

- `LATE_HIGH_RISK_SIGNAL`
- `CONTRADICTORY_INDICATOR`
- `EVIDENCE_CORRECTION`
- `DEPENDENCY_RECOVERY_FINDING`

Rules:

1. Reactivation without a classified cause is rejected.
2. The prior `RESOLVED` event and its evidence remain append-only and are never rewritten.
3. Any prior high-risk resolution authorization becomes stale because the case version changes and must never be inherited.
4. Reactivation cannot jump directly to ordinary monitoring or a second resolution.
5. Every reactivation records actor, reason, trace ID, case version, timestamp, and the classified cause.

## Authority matrix

| Action | SYSTEM | OPERATOR | SUPERVISOR | SAFETY_LEAD | AUDITOR |
|---|---:|---:|---:|---:|---:|
| Open case | allow | allow | allow | allow | deny |
| Start approved contact | allow | allow | allow | allow | deny |
| Record structured indicator | allow | allow | allow | allow | deny |
| Escalate upward | allow | allow | allow | allow | deny |
| Take over contact | deny | allow | allow | allow | deny |
| Transfer ownership | deny | allow | allow | allow | deny |
| Monitor | allow | allow | allow | allow | read only |
| Authorize S3/S4 resolution | deny | deny | allow | allow | deny |
| Resolve S0–S2 | policy constrained | allow | allow | allow | deny |
| Resolve S3–S4 | deny | deny | allow with recorded reason | allow with recorded reason | deny |
| Reactivate a resolved case toward review/escalation | approved cause only | allow with reason | allow | allow | deny |
| Diagnose, prescribe, determine legal fault | deny | outside ROS | outside ROS | outside ROS | deny |
| Dispatch real authority | deny | external approved process | external approved process | external approved process | deny |

## Deadline rules

- Timers are durable, monotonic, versioned, and recovered after restart.
- Clock uncertainty or missing time moves the case to review; it never extends a safety deadline silently.
- Deadline changes require policy versioning and regression evidence.
- A missed deadline emits an immutable audit event and produces escalation even when a preferred channel is unavailable.

## Resolution authorization rules

A high-risk authorization is valid only for the current case version and severity assessment. New contradictory evidence, severity reassessment, stale data, dependency failure, case-version change, or post-resolution reactivation invalidates prior authorization and returns the case to review.
