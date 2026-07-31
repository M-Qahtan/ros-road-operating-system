# ROS Eye Human-Safety Command Center

## Scope

This implementation delivers issue #33 as an Arabic-first, privacy-aware command-center workflow over the approved ROS Eye contracts. It does not introduce real emergency dispatch, diagnosis, legal-fault determination, autonomous case resolution, or road-control authority.

The browser defaults to an explicit deterministic simulation mode. HTTP mode is available through `data-ros-eye-mode="http"` and the typed gateway contract, but the repository does not claim that a production government or emergency integration exists.

## Safety invariants

1. Urgent cases cannot be hidden by operator filters. Overdue, imminent, S4, no-response, and unreachable cases remain pinned into every filtered view.
2. Critical actions fail closed when the selected view is stale, required authority is missing, connectivity is lost, or critical dependencies are unavailable.
3. High-risk resolution requires `SUPERVISOR` or `SAFETY_LEAD`, state `MONITORED`, trusted evidence, healthy connectivity, and healthy dependencies.
4. The UI renders fusion output as `RECOMMENDATION_ONLY` and explicitly states that it cannot downgrade, resolve, dispatch, or reopen roads.
5. General views exclude raw conversations, medical narrative, phone number, token, precise coordinates, and raw evidence.
6. Every simulated manual action records actor, role, reason, version, trace ID, time, and an immutable audit marker.
7. Duplicate manual submissions with the same idempotency key return the original result without adding a second audit event.

## Workflow

- Queue: contact state, severity, deadline, uncertainty, channel, and owner.
- Detail: structured indicators, redacted provenance, system health, fusion explanation, guard state, and immutable audit timeline.
- Actions: operator takeover, escalation, supervisor/safety-lead reassignment, and high-risk resolution authorization.

## Accessibility evidence

- Arabic RTL document and labels.
- Skip link and semantic landmarks.
- Keyboard-focus outlines on every interactive element.
- Large controls and responsive one-column critical path.
- Screen-reader-friendly alert roles and labeled queue/detail sections.
- No color-only urgency communication: every urgent row includes explicit deadline text.
- Reduced-motion support.
- Critical forms remain present but disabled with a blocking explanation when unsafe.

## Acceptance traceability

| Issue #33 criterion | Evidence |
|---|---|
| Deadlines cannot be hidden | `visibleItems()` forces urgent cases into every filtered view; ordering tests |
| Critical controls fail closed | stale/dependency/connectivity/authority gates and tests |
| Least-privilege data | renderer excludes precise location and raw content; privacy assertion |
| Manual audit | simulated gateway appends actor/reason/version/trace/immutable event |
| Keyboard/screen reader path | semantic HTML, skip link, labels, focus styles |
| Simulation is explicit | persistent simulation banner and wording |
| No-response escalation | browser workflow test |
| Operator takeover | controller/gateway workflow and idempotency test |
| Duplicate actions | idempotency-key replay test |
| Stale view | blocking banner and disabled-control test |
| Authorized resolution | supervisor-only monitored/trusted/healthy test |

## Runtime boundary

`HttpHumanSafetyCommandCenterGateway` defines the expected vendor-neutral HTTP surface:

- `GET /api/v1/human-safety/cases`
- `GET /api/v1/human-safety/cases/{caseId}`
- `POST /api/v1/human-safety/cases/{caseId}/takeover`
- `POST /api/v1/human-safety/cases/{caseId}/escalate`
- `POST /api/v1/human-safety/cases/{caseId}/assignment`
- `POST /api/v1/human-safety/cases/{caseId}/resolution-authorization`

Production composition must bind these endpoints to the authoritative PostgreSQL-backed ROS Eye services and privacy/authorization controls already merged under issues #28–#34. The simulation adapter is never evidence of real dispatch or production readiness.
