# ADR-005 — Object Storage Replacement Evaluation

- **Status:** Proposed / evaluation only
- **Authority:** REPO_WRITE + SANDBOX_EXECUTION only
- **Decision owner:** Founder / independent review gate
- **Runtime impact:** None until separately adopted
- **Vehicle authority:** Unchanged — ADVISORY_ONLY

## Context

ROS evidence storage currently depends on MinIO-compatible S3 behavior for local and CI verification. The currently referenced MinIO registry artifacts are no longer reliably pullable, repeatedly failing exact-head CI with registry authorization errors. This is a dependency-lifecycle and supply-chain risk, not evidence that ROS runtime semantics should be weakened.

ROS must not replace an evidence component merely to make CI green. Any replacement must preserve the evidence contract and fail closed.

## Requirement → Hazard → Code → Test → Evidence

### Requirements
1. S3-compatible boundary sufficient for the existing Evidence Service.
2. Content integrity and checksum verification.
3. Bucket/object versioning required by the evidence lifecycle.
4. Object Lock semantics: COMPLIANCE, GOVERNANCE, and Legal Hold where used by ROS.
5. Tenant and RoadEvent isolation.
6. Deterministic local/CI startup and restart.
7. Immutable, attributable dependency artifacts.
8. Storage or metadata uncertainty must never produce false success or reduced retention.

### Hazards
- H-OS-01: evidence accepted but not durably stored.
- H-OS-02: retention metadata missing/corrupt/unreadable and object treated as unlocked.
- H-OS-03: COMPLIANCE retention bypass.
- H-OS-04: unauthorized GOVERNANCE bypass.
- H-OS-05: Legal Hold ignored.
- H-OS-06: cross-tenant or cross-RoadEvent disclosure/overwrite.
- H-OS-07: restart/recovery loses evidence or lock state.
- H-OS-08: mutable/unverifiable image changes CI behavior.
- H-OS-09: compatibility shim silently changes Evidence Service semantics.

### Candidate implementation boundary
A candidate may be wired only behind the existing S3-compatible adapter in local/CI sandbox configuration. No production, cloud, public-road, partner, camera/device, dispatch, signal, or vehicle-control activation is authorized by this ADR.

### Mandatory verification
A candidate is rejected unless all applicable tests pass on an exact candidate revision:

1. upload + read-back + checksum equality;
2. versioning and overwrite behavior;
3. COMPLIANCE retention prevents deletion before expiry;
4. GOVERNANCE retention rejects ordinary deletion and permits only explicitly authorized bypass;
5. Legal Hold prevents deletion;
6. retention/lock state survives restart;
7. missing, malformed, corrupt, or unreadable retention metadata fails closed — deletion is denied;
8. storage unavailable during evidence write returns failure, never false success;
9. tenant isolation;
10. RoadEvent/evidence-key isolation;
11. existing Evidence Service integration contract passes without authority expansion;
12. dependency artifact is pinned immutably and provenance/security evidence is recorded.

## Decision process

No storage implementation is selected by this ADR. Candidates follow:

`Benchmark → ADR evidence → bounded prototype → destructive/fault tests → compare → independent review → Adopt/Reject`

SeaweedFS is the first prototype candidate because it exposes an S3-compatible surface and documents Object Lock capabilities, but it receives no trust exemption. RustFS or any other candidate may be compared only under the same test matrix. Prior vulnerabilities or fail-open behavior become explicit regression tests rather than informal assurances.

## Evidence package required for adoption

The adoption PR must contain or link:
- exact candidate version and immutable digest;
- provenance/signature/SBOM evidence where available;
- test logs bound to the exact commit;
- destructive retention test results;
- restart/recovery results;
- negative metadata-read/corruption results;
- dependency/security review;
- architecture diff;
- rollback procedure;
- independent reviewer disposition.

Green CI alone is insufficient evidence for adoption.

## Fail-closed / rollback

Until a candidate passes the full gate and is independently reviewed, ROS remains NO-GO for any workflow whose readiness requires object-storage evidence. The existing dependency may remain documented as broken; tests must not be weakened, skipped, or converted to success.

A prototype is removable by reverting its isolated sandbox/CI wiring. It must not alter production configuration or Evidence Service authority semantics.

## Decision

**PROPOSED:** evaluate a replacement object-storage implementation under the mandatory matrix above. No candidate is adopted by this record. No operational authority is granted.
