# ROS Eye hazard log and verification traceability

Risk classification is conservative. P0 means credible risk of loss of life or an unsafe authoritative decision. P1 means degradation that can threaten P0 controls if prolonged.

| Hazard | Class | Unsafe condition | Prevention control | Detection control | Required safe state | Verification evidence | Owner |
|---|---|---|---|---|---|---|---|
| HSE-01 | P0 | credible incident never opens a case | durable ingestion, provenance, idempotent correlation | missing-case reconciliation and signal-to-case metrics | HUMAN_REVIEW or ESCALATED | #30 ingestion E2E + #35 reconciliation scenario | Signal Integrity Lead |
| HSE-02 | P0 | conflicting evidence lowers risk | uncertainty cannot authorize downgrade/resolution | contradiction reason code and audit alert | HUMAN_REVIEW | contract test in this issue; #32 false-negative suite | Safety Architect |
| HSE-03 | P0 | no-response silently treated as safe | durable deadline and mandatory escalation | overdue-case query and operator alarm | ESCALATED | contract test; #31 restart/deadline E2E | Conversation Runtime Lead |
| HSE-04 | P0 | S3/S4 resolved without human authority | version-bound supervisor/safety-lead authorization | authorization audit invariant | HUMAN_REVIEW | contract test; #33 browser authorization test; #35 E2E | Safety Lead |
| HSE-05 | P0 | connectivity loss hides unresolved case | loss-of-connectivity fail-safe transition | channel health and deadline monitor | ESCALATED | contract test; #31 disconnect/recovery test | Communications Lead |
| HSE-06 | P0 | database failure acknowledges non-durable safety action | fail-closed command admission and atomic audit | readiness and write verification | rejected write + ESCALATED backlog | #22 fault injection; #31 PostgreSQL recovery | Reliability Lead |
| HSE-07 | P0 | stale UI permits critical action | version checks and stale-control disabling | freshness watermark and conflict response | action rejected | #33 browser stale-state test | Command Center Lead |
| HSE-08 | P0 | duplicate/replayed callback creates duplicate contacts or case | idempotency and replay token | duplicate counters and invariant checks | one durable intent | #30 anti-replay; #31 callback storm; #35 chaos | Runtime Lead |
| HSE-09 | P0 | malicious signal gains operational authority | signature/provenance gates and quarantine | anomaly and revocation hooks | quarantine + HUMAN_REVIEW | #30 adversarial fixtures; #34 abuse tests | Security Lead |
| HSE-10 | P0 | raw sensitive data leaks through logs/artifacts | allow-list telemetry and field classification | secret/PII scanners and artifact review | release blocked | #20 security gates; #34 privacy CI | Privacy Lead |
| HSE-11 | P0 | cross-case evidence or contact data exposed | case-scoped authorization and tenant isolation | denied-access audit alert | access denied | #34 authorization suite; #35 red team | Security Lead |
| HSE-12 | P0 | model/rule output becomes autonomous authority | recommendation-only contract and domain invariant | authority-source audit check | HUMAN_REVIEW | #32 governance tests; #35 adversarial suite | Model Governance Lead |
| HSE-13 | P1 | retry storm overwhelms contact channels | bounded retry, jitter, rate limits, circuit breaker | queue age/attempt metrics | degraded mode + operator queue | #31 retry-storm test; #35 load baseline | Runtime Lead |
| HSE-14 | P1 | clock skew corrupts deadlines or event order | received-time fallback and uncertainty flag | skew threshold alert | HUMAN_REVIEW | #30 clock-skew fixtures | Signal Integrity Lead |
| HSE-15 | P1 | device power loss ends monitoring silently | device-loss event and fallback policy | heartbeat expiry | ESCALATED | #36 device/power-loss simulation | Mobile Safety Lead |
| HSE-16 | P1 | operator takeover conflicts with automation | exclusive ownership lease and automation suppression | concurrent-action conflict audit | operator-owned safe state | #31 takeover test; #33 browser E2E | Operations Lead |
| HSE-17 | P1 | transfer assumed complete without acknowledgement | two-phase transfer and current-owner retention | transfer timeout | ESCALATED or retained owner | #31 transfer test; #35 delayed-ack scenario | Operations Lead |
| HSE-18 | P1 | evidence integrity failure is treated as available | checksum, scan, and quarantine gates | integrity mismatch audit | metadata retained, content unavailable | existing evidence suite + #35 | Evidence Lead |

## Audit evidence contract

Every P0/P1 control must produce evidence containing:

- immutable candidate commit SHA;
- hazard identifier;
- control and test identifier;
- case/signal identifiers that contain no direct personal information;
- result and required safe state;
- policy/contract version;
- trace ID and test execution identifier;
- explicit limitations and residual risk.

Missing, skipped, stale, or failed evidence is a release failure.

## Residual-risk policy

Residual P0 risk cannot be accepted by an engineering agent. It requires a recorded founder/executive decision plus independent legal, clinical, security, privacy, operational, and relevant governmental review before any field use. Engineering evidence proves only the tested software behavior.
