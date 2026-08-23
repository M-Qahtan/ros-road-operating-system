# ROS Map Provider Controlled Sandbox Runbook

## Purpose

Produce one reproducible, low-risk routing evidence package for ROS MVP RC1 without authorizing production, public-road control or safety-critical action.

**Authoritative RC1 main SHA:** `6f7263e9ec878d2bec3c84f6651fe8b1a1da5292`

The executable code for a sandbox run must be bound to the exact reviewed PR head derived from this SHA. If the branch head changes, discard prior code-bound evidence and rerun validation.

## Allowed provider scope

First candidate: Google Maps Platform Routes API through `GoogleRoutesSandboxProvider`.

Allowed outbound data:

- origin latitude/longitude;
- destination latitude/longitude;
- `DRIVE` travel mode;
- `TRAFFIC_UNAWARE` or `TRAFFIC_AWARE` routing preference.

Forbidden outbound data:

- RoadEvent/case/evidence identifiers;
- media, evidence bytes or object-storage references;
- medical, legal, insurance or fault narratives;
- tenant/purpose/actor identifiers;
- phone numbers, names or device identifiers;
- tokens other than the provider credential required by the provider request.

## Preconditions

1. PR containing the adapter is green and independently reviewable.
2. Provider project/billing approval is explicitly granted.
3. API key exists only in the approved secret boundary and is restricted to the Routes API and approved source/runtime where supported.
4. No credential is committed, pasted into an issue, attached to evidence or written to logs.
5. Test coordinates are synthetic/non-personal and inside the approved Riyadh lab scenario.
6. ROS remains SHADOW_ONLY / recommendation-only.

## Test matrix

Run at least these cases against the same exact code SHA:

| Case | Expected result |
| --- | --- |
| Traffic-aware valid route | `OK`, distance/duration present, bounded TTL |
| Provider 4xx/5xx | `DEGRADED`, no safety-state mutation |
| Provider timeout | `DEGRADED`, bounded completion |
| Non-JSON/malformed body | `DEGRADED` |
| Oversized response | `DEGRADED` |
| Stale response | `DEGRADED` |
| Wrong provider identity | `DEGRADED` |
| Extra sensitive input field | rejected before network call |
| Invalid coordinate | rejected before network call |

## Evidence to capture

Capture only sanitized evidence:

- repository + exact Git SHA;
- provider identifier and request type;
- synthetic coordinate fixture identifier (not raw personal trip history);
- start/end trusted timestamps;
- HTTP status class or failure category, with headers/credentials redacted;
- result state `OK` or `DEGRADED`;
- duration/distance and response TTL when `OK`;
- assertion that no forbidden outbound fields were present;
- assertion that RoadEvent/S3/S4 state was not mutated;
- test command, exit status and CI/run identifier;
- SHA-256 of the sanitized evidence bundle.

Do not archive raw provider credentials or unrestricted request/response headers.

## PASS / NO-GO

PASS requires all test cases to preserve the advisory-only boundary, no forbidden outbound fields, no credential leakage, bounded failure handling and zero safety-state mutation.

Any credential exposure, hidden sensitive field, stale route accepted as current, provider result changing authoritative safety state, unbounded request, or unresolved P0/P1 finding is **NO-GO**.

## Explicit non-authority

Passing this runbook does **not** authorize Terraform apply, production deployment, public-road operation, emergency dispatch, live camera ingestion, road closure/reopening, or vehicle actuation.
