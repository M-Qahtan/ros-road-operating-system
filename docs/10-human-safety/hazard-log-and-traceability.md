# ROS Eye hazard log and verification traceability

Risk classification is conservative. P0 means credible risk of loss of life or an unsafe authoritative decision. P1 means degradation that can threaten P0 controls if prolonged.

| Hazard | Class | Unsafe condition | Prevention control | Detection control | Required safe state | Verification evidence | Owner |
|---|---|---|---|---|---|---|---|
| HSE-01 | P0 | credible incident never opens a case | durable ingestion, provenance, idempotent correlation | missing-case reconciliation and signal-to-case metrics | HUMAN_REVIEW or ESCALATED | #30 ingestion E2E + #35 reconciliation scenario | Signal Integrity Lead |
| HSE-02 | P0 | conflicting, ambiguous, or missing evidence lowers attention | every de-escalation to MONITORED requires healthy dependencies and a version-bound supervisor/safety-lead uncertainty-resolution authorization | reason-coded rejected transition and revision mismatch audit | remain HUMAN_REVIEW or ESCALATED | `human-safety-contract.spec.ts`; issue #44; #32 false-negative suite | Safety Architect |
| HSE-03 | P0 | no-response silently treated as safe | durable deadline and mandatory escalation | overdue-case query and operator alarm | ESCALATED | contract test; #31 restart/deadline E2E | Conversation Runtime Lead |
| HSE-04 | P0 | S3/S4 resolved without current human authority | authorization bound to case, severity, evidence, indicator, connectivity, dependency and time revisions | authorization audit invariant including deterministic `authorizedByRole` | HUMAN_REVIEW | contract test; #33 browser authorization test; #35 E2E | Safety Lead |
| HSE-05 | P0 | connectivity loss hides unresolved case | loss-of-connectivity fail-safe transition | channel health and deadline monitor | ESCALATED | contract test; #31 disconnect/recovery test | Communications Lead |
| HSE-06 | P0 | database or dependency failure acknowledges resolution | fail-closed resolution and command admission | readiness, recovery and transition rejection evidence | action rejected + ESCALATED | #22 fault injection; contract test; #31 recovery | Reliability Lead |
| HSE-07 | P0 | stale UI permits critical action | version checks and stale-control disabling | freshness watermark and conflict response | action rejected | #33 browser stale-state test | Command Center Lead |
| HSE-08 | P0 | duplicate/replayed signal creates duplicate indicators, contacts, or cases | mandatory acceptance orchestration with vendor-neutral atomic nonce check-and-consume; global uniqueness is keyed by `nonceDigest` across signal/source scopes while `scopeDigest` is audit context only; structural validation can never emit ACCEPT | replay policy/version, scope digest, bounded expiry and consume result without raw token | duplicate quarantined; registry failure HUMAN_REVIEW | `human-safety-authority-and-signal-contract.spec.ts`; issue #45; #30 anti-replay | Runtime Lead |
| HSE-09 | P0 | malicious signal gains operational authority | strict semantic, signature, provenance and purpose gates plus quarantine | anomaly and revocation hooks | quarantine + HUMAN_REVIEW | contract tests; #30 adversarial fixtures; #34 abuse tests | Security Lead |
| HSE-10 | P0 | raw sensitive data or replay token leaks through logs/artifacts | allow-list telemetry, field classification and digest-only replay audit | secret/PII scanners and artifact review | release blocked | #20 security gates; contract tests; #34 privacy CI | Privacy Lead |
| HSE-11 | P0 | cross-case evidence or contact data exposed | case-scoped authorization and tenant isolation | denied-access audit alert | access denied | #34 authorization suite; #35 red team | Security Lead |
| HSE-12 | P0 | model/rule output becomes autonomous authority | recommendation-only contract and domain invariant | authority-source audit check | HUMAN_REVIEW | #32 governance tests; #35 adversarial suite | Model Governance Lead |
| HSE-13 | P1 | retry storm overwhelms contact channels | bounded retry, jitter, rate limits, circuit breaker | queue age/attempt metrics | degraded mode + operator queue | #31 retry-storm test; #35 load baseline | Runtime Lead |
| HSE-14 | P1 | clock skew, future-dated or stale signals corrupt replay TTL, deadlines or event order | temporal policy requires `occurredAt <= receivedAt <= evaluatedAt + allowedClockSkew`, enforces maximum signal age, and derives nonce expiry from the bounded minimum of sender receipt and trusted evaluation time | temporal-policy version, reason-coded future/stale rejection and bounded replay expiry evidence | HUMAN_REVIEW or quarantine | contract tests; issue #52; #30 clock-skew fixtures | Signal Integrity Lead |
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

Replay evidence stores only the replay policy version, nonce digest used as the global uniqueness key, scope digest used as audit context, trusted bounded expiry, temporal-policy version, and consume result. Raw replay tokens are prohibited from logs, traces, metrics, audit events, and artifacts.

Missing, skipped, stale, or failed evidence is a release failure.

## Residual-risk policy

Residual P0 risk cannot be accepted by an engineering agent. It requires a recorded founder/executive decision plus independent legal, clinical, security, privacy, operational, and relevant governmental review before any field use. Engineering evidence proves only the tested software behavior.
