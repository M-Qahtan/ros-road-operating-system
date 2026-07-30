# ROS Eye Safety Fusion and Uncertainty Engine

## Purpose

This component combines approved structured safety evidence into an explainable recommendation for human review. It is not a diagnosis engine, a dispatch authority, a legal-fault engine, or an autonomous case-resolution service.

The engine is deterministic for the same versioned input, trusted evaluation time, guard results, rule-set version, and threshold version.

## Architecture

```text
Approved structured evidence
  ├─ source reliability and integrity
  ├─ recency and clock quality
  ├─ device condition
  ├─ corroboration groups
  ├─ contact-session state
  └─ structured indicator codes only
             │
             ▼
Strict contract and vocabulary validation
             │ fail closed
             ▼
Data quality / drift / OOD / adversarial guards
             │
             ▼
Deterministic contribution scoring
             │
             ├─ risk contribution
             ├─ bounded safety offset
             ├─ corroboration bonus
             ├─ contradiction penalty
             ├─ stale/sparse uncertainty
             └─ contact-state risk floor
             │
             ▼
Recommendation-only result
  ├─ S0–S4 recommended severity
  ├─ confidence and uncertainty
  ├─ stable reason codes
  ├─ missing-evidence flags
  ├─ per-source structured contributions
  ├─ guard results
  ├─ deterministic fingerprint
  └─ mandatory human-review state
```

## Non-negotiable invariants

1. A recommendation never lowers the current severity. Any lower raw score is fenced by `FUSION_AUTONOMOUS_DOWNGRADE_BLOCKED`.
2. S3 and S4 always require human review.
3. Contradictory, stale, sparse, degraded, unverified, out-of-distribution, or guard-unavailable input increases uncertainty and cannot silently reduce risk.
4. A blocked guard produces at least an S3 review recommendation with zero confidence and maximum uncertainty.
5. The output authority is always `RECOMMENDATION_ONLY`.
6. Autonomous downgrade, closure, dispatch, diagnosis, road reopening, and legal-fault attribution are always false or outside the contract.
7. Raw conversation, medical narrative, phone numbers, tokens, precise location, protected attributes, and free-form prose are not accepted by the fusion contract or stored in fusion evidence tables.
8. Threshold or rule changes require a new version, an approver, regression-evidence digest, and rollback version.

## Deterministic baseline

The baseline converts each structured evidence item into a signed contribution using:

```text
base weight
× freshness factor
× reliability factor
× integrity factor
× device-condition factor
× risk/safety direction
```

Risk evidence contributes positively. Verified, recent safety evidence may apply only a small bounded offset. Safety evidence cannot lower the result below the current case severity.

The engine adds conservative risk for no-response, unreachable, disconnected, or unavailable-channel states. Independent recent trusted source types provide a bounded corroboration bonus.

## Uncertainty model

Uncertainty starts from a small baseline and increases for:

- contradictory evidence;
- fewer than two recent trusted sources;
- stale evidence;
- degraded or unknown device condition;
- unverified integrity;
- drift, OOD, adversarial, or data-quality guard findings;
- no-response, unreachable, or disconnected contact state;
- missing contact outcome, location quality, corroboration, or guard clearance.

Confidence is evidence quality reduced by uncertainty. Confidence is not authority.

## Guard boundary

Guards are versioned ports:

- `DATA_QUALITY`
- `DRIFT`
- `OUT_OF_DISTRIBUTION`
- `ADVERSARIAL_INPUT`

A guard adapter failure, malformed guard response, or input-version mismatch becomes `BLOCK_AND_REVIEW`. Guard failure never produces a low-risk recommendation.

## Registry and rollback

The active baseline is:

```text
Rule set:  ros-eye.safety-fusion.rules.v1
Threshold: ros-eye.safety-fusion.thresholds.v1
Policy:    ros-eye.safety-fusion.v1
Registry:  ros-eye.safety-fusion.registry.v1
Rollback:  ros-eye.safety-fusion.rules.safe-default.v0
```

PostgreSQL stores reviewed rule metadata, immutable recommendations, and release evidence packages. The active rule requires an approved regression digest and rollback target. Evidence packages cannot be stored when under-triage, missed-human-review, false-negative-weight, or determinism gates are non-zero.

## Evaluation

Synthetic de-identified fixtures prioritize false-negative protection:

- airbag plus no response;
- rollover plus help request;
- contradictory response;
- stale sparse evidence;
- attempted high-risk downgrade;
- corroborated low-risk response.

The evaluation gate fails on:

- any recommendation below the fixture minimum;
- any missed required human review;
- any deterministic fingerprint mismatch;
- any non-zero safety-weighted false-negative score.

The evidence package binds:

- candidate head SHA;
- candidate base SHA;
- tested merge SHA;
- workflow run ID and attempt;
- fixture digest;
- result digest;
- safety metrics.

## Persistence boundary

`ros_eye_safety_fusion_recommendations` stores structured recommendation metadata only. It enforces:

- recommended severity rank is never below current severity;
- S3/S4 require human review;
- authority is recommendation-only;
- autonomous downgrade, closure, and dispatch are false;
- deterministic fingerprint format;
- append-only mutation rejection.

`ros_eye_safety_fusion_evidence_packages` stores only passing SHA-bound evaluation evidence and is append-only.

## Integration boundary

The engine may provide a recommendation to the HumanSafetyCase application layer. Existing domain authorization remains authoritative. The fusion engine cannot directly transition a case, resolve uncertainty, authorize a downgrade, close a case, or invoke a real agency adapter.
