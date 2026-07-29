# Human contact protocol acceptance and hazard traceability

| Scenario | Hazard link | Required control | Safe state | Deterministic evidence |
|---|---|---|---|---|
| Person responds | HSE-04/HSE-12 | structured options; no diagnosis; identity confidence tracked | RESPONSE_CONFIRMED or HUMAN_REVIEW | response and identity tests |
| Silence/no response | HSE-03 | explicit deadline, bounded retry, attempt cap | NO_RESPONSE then HUMAN_REVIEW/ESCALATED | silence and retry exhaustion tests |
| Channel disconnect | HSE-05 | channel health gate and retry deadline | DISCONNECTED then review/escalation | disconnect test |
| Channel unavailable | HSE-05/HSE-06 | fail closed; no silent progression | HUMAN_REVIEW | channel-failure test |
| Accessibility path unavailable | HSE-03/HSE-05 | modality requirements treated as safety preconditions | HUMAN_REVIEW | accessibility-failure test |
| Duplicate reply | HSE-08 | atomic idempotency check-and-consume | QUARANTINE | sequential and concurrent duplicate tests |
| Reply registry unavailable | HSE-06/HSE-08 | no processing without uniqueness proof | HUMAN_REVIEW | unavailable/throwing registry tests |
| Contradictory reply | HSE-02/HSE-09 | contradiction cannot produce reassurance or completion | HUMAN_REVIEW | contradictory option test |
| Sensitive free text | HSE-10 | allow-listed structured envelope; unknown fields rejected | QUARANTINE | free-text test |
| Retry storm | HSE-13 | max three automated attempts; runtime jitter/rate limit required | ESCALATED | retry exhaustion test |
| Operator takeover | HSE-16 | explicit transition, audit action, automation suppression contract | OPERATOR_TAKEOVER | takeover test |
| Incomplete transfer | HSE-17 | downstream two-phase acknowledgement required | retained owner or ESCALATED | planned #31 integration test |
| Unconfirmed identity at completion | HSE-04/HSE-12 | completion cannot imply parent-case resolution | HUMAN_REVIEW | identity confidence test |
| Stale session command | HSE-07 | expected-version check | HUMAN_REVIEW | stale version test |

## Release limitations

The tests establish deterministic contract behavior only. They do not constitute clinical validation, accessibility certification, telecom approval, public-road authorization, emergency-service integration approval, or permission to deploy production wording.
