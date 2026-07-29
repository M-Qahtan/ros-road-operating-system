# ROS Eye multimodal safety-signal ingestion and provenance

## Status

Implementation contract for issue #30. This layer consumes the human-safety signal contracts merged by #28 and does not grant operational or governmental authority.

## Trust boundary

```text
local deterministic adapter
        |
        v
structural validation --fail--> quarantine / human review
        |
        v
source trust + revocation --fail--> quarantine / human review
        |
        v
per-source rate limit + bounded queue --fail--> backpressure / degraded readiness
        |
        v
mandatory acceptance orchestration
  - trusted-time chronology / skew / age
  - signature and semantic policy
  - global nonceDigest atomic consume
        |
        v
raw evidence store (separate object) + redacted provenance metadata
        |
        v
idempotent safety-intent creation
```

Structural validation never returns `ACCEPT`. An accepted signal must pass the #28 replay and temporal policies through the mandatory acceptance orchestrator. `nonceDigest` is the atomic global uniqueness key for the policy TTL; `scopeDigest` is audit context only. Raw replay tokens are never stored in provenance, quarantine, logs, or evidence.

## Safe dispositions

| Condition | Disposition |
|---|---|
| malformed schema, invalid signature, duplicate/replay, revoked source | `QUARANTINED` |
| unverifiable source, registry unavailable, stale/future timestamp, poor location accuracy, persistence failure | `HUMAN_REVIEW` |
| per-source limit or bounded-queue pressure | `BACKPRESSURE` + degraded readiness |
| all controls pass | `ACCEPTED` with provenance and idempotent safety intent |

No rejection is silently dropped. Every rejected input produces a reason-coded quarantine record when the quarantine store is available. Quarantine-storage failure itself marks readiness degraded.

## Data boundary

Accepted provenance contains pseudonymous source/signal/correlation identifiers, timestamps, policy versions, reasoned quality inputs, location accuracy band, replay scope digest, and an opaque raw-evidence reference. It excludes precise coordinates, raw evidence bytes, medical narrative, direct personal identifiers, and raw replay tokens.

Raw evidence is held by a dedicated `RawEvidenceStorePort`. The operational metadata layer receives only an opaque reference. This implementation includes deterministic in-memory adapters for contract tests; production object storage, hardware SDKs, vehicle control, and continuous surveillance are outside issue #30.

## Backpressure and recovery

The service exposes bounded queue depth, per-source fixed-window admission, explicit degraded readiness, and reason-coded backpressure. Downstream implementations must preserve bounded memory, retry jitter, dead-letter/quarantine semantics, and no silent loss during disconnect/recovery.

## Deterministic simulators

Local fixtures cover phone motion/location metadata, vehicle event metadata, structured person reports, operator observations, and infrastructure metadata. The future wearable fixture is deliberately unsupported and must enter quarantine/review until a separately approved schema and purpose policy exists. Simulator output is test data and makes no sensor-truth claim.

## Hazard traceability

| Hazard | Control in #30 | Verification |
|---|---|---|
| HSE-01 missing safety case intent | idempotent `createIfAbsent` intent record after accepted provenance | accepted multimodal fixture tests |
| HSE-08 duplicate/replayed signal | mandatory orchestration and global atomic nonce consume | same-envelope, cross-scope and concurrent replay tests |
| HSE-09 malicious signal authority | signature/schema/purpose/source-revocation/quarantine gates | malformed, bad-signature, revoked-source and unsupported wearable tests |
| HSE-10 sensitive data leakage | redacted provenance and separate raw-evidence store | precise-coordinate, raw-token and raw-byte absence assertions |
| HSE-13 retry storm | bounded queue and per-source rate limits | rate-limit/backpressure tests |
| HSE-14 clock skew/event order | #28 temporal policy used without bypass | stale/future/missing timestamp tests |

## Residual boundaries

This layer does not diagnose, recommend treatment, determine legal fault, dispatch a real authority, control a vehicle, lower severity, resolve a human-safety case, or authorize road closure/reopening. Untrusted evidence remains non-authoritative and is routed toward quarantine or human review.
