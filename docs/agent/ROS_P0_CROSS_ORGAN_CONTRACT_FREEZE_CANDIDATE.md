# ROS P0 Cross-Organ Contract Freeze Candidate

Status: REVIEW CANDIDATE — not an authority, deployment, field, or adoption approval.
Baseline: main@3255a94a7f78607014a410e083174483fa2c2c2f
Directive: #181 / #182

## Safety invariants
Human Safety > Mobility > Efficiency.
Brain may reason; Heart may veto.
Compromise can only reduce authority.
No critical action without Evidence + Authority + Purpose + Audit.
No contract grants S3/S4 authority, public-road operation, emergency dispatch, signal actuation, live-camera access, or vehicle control.
Critical paths fail closed when required identity, purpose, jurisdiction, integrity, provenance, freshness, authority, or audit state is absent/invalid.

## Governed reference path
Ingress -> Adapter -> Durable Inbox/Idempotency -> CPAL/EIL -> RoadEvent/CRS -> Brain/Planner (optional, shadow where required) -> Heart (mandatory veto) -> Human Review/Operations -> Advisory Effect Request -> Audit/Evidence.

No organ may bypass Heart, tenant/purpose isolation, or evidence/audit ownership boundaries.

## Minimum canonical envelope
Every cross-organ critical message MUST carry or resolve, before use:
- schema_id + schema_version
- event/message identity + idempotency key
- trace/correlation identity
- source timestamp + receive timestamp + freshness/TTL
- tenant identity
- purpose
- jurisdiction
- source/device/adapter identity
- provenance + lineage references
- integrity/signature state
- location + coordinate/frame reference where applicable
- security classification
- authority context (never inferred from authentication alone)
- policy snapshot/version used for the decision
- evidence references, contradiction/uncertainty state where applicable

Unknown, missing, expired, contradictory, unverifiable, or out-of-jurisdiction critical fields MUST NOT be silently defaulted into higher authority.

## Evidence semantics
Report != RoadEvent.
Message Count != Evidence Count.
Identity != Independence.
Security Certificate != Truth.
Sensor Output != Ground Truth.
Retries, replicas, fan-out, replay, or correlated sources MUST NOT manufacture independent evidence or quorum.
CPAL/EIL owns freshness, health, calibration, provenance, lineage, independence, contradiction, replay, purpose, and jurisdiction checks before cognitive use.

## Authority semantics
Authentication establishes identity, not truth or permission.
Brain/Planner output is a proposal, never permission.
Heart veto is mandatory on every critical effect path.
Compromise/degradation may only preserve or reduce authority; it may never escalate it.
Effect requests remain advisory unless separately authorized by an explicit founder-approved gate and external authority.

## Durability and replay
Critical state transitions MUST survive process restart using the governed durable runtime.
Inbox/outbox and command handling MUST be idempotent.
Replay MUST preserve tenant/purpose boundaries, evidence identity, ordering/fencing rules, and auditability.
In-memory-only success is insufficient evidence for a critical path.

## Required negative/fault proof before freeze
1. restart/replay across PostgreSQL/Redis/outbox;
2. duplicate and conflicting idempotency keys;
3. cross-tenant and wrong-purpose attempts;
4. expired/future/skewed timestamps and stale evidence;
5. provenance/lineage break and duplicate/correlated evidence;
6. contradiction and insufficient-independent-evidence cases;
7. malicious authority escalation and compromised-source degradation;
8. Heart veto enforcement and attempted bypass;
9. audit/evidence sink unavailable or integrity failure;
10. schema/version incompatibility and unknown critical fields.

## Traceability gate
For each critical contract:
Requirement -> Hazard -> Design/Contract -> Code -> Test -> exact-SHA Evidence -> Independent Review -> Gate.

A passing CI/simulation result is laboratory evidence only. It is not real-device, staging, shadow-pilot, or field proof.

## Freeze exit criteria
This candidate may become FROZEN only when:
- existing schemas/interfaces are reconciled rather than duplicated;
- every critical interface maps to owning code and tests;
- the negative/fault suite passes on one exact head SHA;
- evidence artifacts are immutable/digest-addressed where applicable;
- independent review approves that exact SHA;
- zero unresolved P0/P1 contract/safety defects remain for this slice.

Until then: WHOLE_BODY_E2E=NOT_PROVEN; STAGING=NO_GO; CONTROLLED_PILOT=NO_GO; FIELD=HOLD.
