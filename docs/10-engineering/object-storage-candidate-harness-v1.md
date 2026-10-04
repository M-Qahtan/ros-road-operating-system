# Object Storage Candidate Harness v1

- **Status:** Test contract / prototype only
- **Authority:** REPO_WRITE + SANDBOX_EXECUTION only
- **Parent gate:** ADR-005
- **Runtime impact:** None
- **Vehicle authority:** Unchanged — ADVISORY_ONLY

## Purpose

This harness defines the evidence contract for evaluating an object-storage candidate behind the existing S3-compatible boundary. It does not adopt a provider and must not be used to weaken or bypass ROS readiness gates.

Every run must preserve the chain:

`Requirement → Hazard → Code/Fixture → Test → Evidence`

## Run validity

A run is valid only when its evidence records:

- ROS commit SHA;
- harness revision;
- candidate name, exact version, and immutable image digest;
- execution timestamp;
- isolated sandbox/CI environment identifier;
- result and evidence reference for every case below;
- confirmation that no production, cloud, public-road, partner, live-device, dispatch, traffic-signal, or vehicle-control integration was touched.

Allowed outcomes are `PASS`, `REJECT`, `NOT_PROVEN`, and `INVALID_RUN`.

A missing fixture, unsupported operation, ambiguous result, missing evidence, mutable candidate reference, or incomplete run must never be converted to PASS.

## Cases

| ID | Requirement / hazard | Verification | Reject condition |
| --- | --- | --- | --- |
| OS-C01 | Integrity / H-OS-01 | Upload, read back, and verify checksum equality. | Missing object, mismatched bytes/checksum, or false success. |
| OS-C02 | Versioning / H-OS-01,H-OS-09 | Write successive versions and prove version identity/read-back semantics. | Silent overwrite or incompatible version semantics. |
| OS-C03 | COMPLIANCE / H-OS-03 | Apply COMPLIANCE retention; ordinary and privileged deletion before expiry must fail. | Any pre-expiry deletion succeeds. |
| OS-C04 | GOVERNANCE / H-OS-04 | Ordinary deletion must fail; only an explicitly authorized bypass fixture may succeed. | Ordinary deletion succeeds or bypass occurs without explicit authorization. |
| OS-C05 | Legal Hold / H-OS-05 | Enable Legal Hold and prove version deletion is denied. | Held version can be deleted. |
| OS-C06 | Restart / H-OS-07 | Restart candidate; re-read evidence, versions, retention, and hold state. | Evidence or protection state is lost/weakened. |
| OS-C07 | Metadata uncertainty / H-OS-02 | Inject missing, malformed, corrupt, or unreadable retention metadata using a bounded fixture. | **HARD REJECT:** uncertainty is interpreted as unlocked or permits deletion. |
| OS-C08 | Storage outage / H-OS-01 | Make storage unavailable during evidence write. | API/workflow reports durable success or persists a false-success state. |
| OS-C09 | Tenant isolation / H-OS-06 | Attempt cross-tenant read/write/overwrite using valid test identities. | Unauthorized cross-tenant access or mutation succeeds. |
| OS-C10 | RoadEvent isolation / H-OS-06 | Attempt cross-RoadEvent evidence-key access/mutation. | Evidence scope can be crossed without authorization. |
| OS-C11 | Existing contract / H-OS-09 | Run the existing Evidence Service integration contract unchanged except candidate endpoint/config. | Candidate requires weakened assertions or authority expansion. |
| OS-C12 | Supply chain / H-OS-08 | Record immutable digest and available provenance/signature/SBOM/security evidence. | Candidate is mutable/unattributable or required provenance evidence is absent. |
| OS-C13 | Container destruction / H-OS-03,H-OS-05,H-OS-07 | With a retained version, attempt bucket deletion under COMPLIANCE; repeat independently under Legal Hold; after each denial, read back the protected version. | **HARD REJECT:** bucket deletion succeeds, protection is bypassed, or protected evidence is no longer recoverable. |

## Fail-closed rules

1. OS-C07 and OS-C13 are hard-reject safety cases. A fail-open observation rejects that candidate revision.
2. If a destructive/fault fixture cannot be executed safely, record `NOT_PROVEN`; do not infer compatibility.
3. Candidate-specific shims must not change Evidence Service authority or turn an error/unknown state into success.
4. Test skips caused by candidate incompatibility are not PASS.
5. Green generic CI is not adoption evidence.

## Evidence record

For each case record:

`case_id | requirement | hazard | fixture/code revision | expected result | observed result | outcome | evidence reference`

The final candidate disposition is:

- **REJECT** if any case is REJECT;
- **NOT_PROVEN** if none reject but one or more cases are NOT_PROVEN;
- **INVALID_RUN** if run-validity requirements are not met;
- **PASS** only if all thirteen cases PASS.

A PASS authorizes only progression to independent review and an explicit adoption decision. It does not authorize merge, deployment, infrastructure mutation, public-road activation, partner activation, or any expansion beyond ADVISORY_ONLY.
