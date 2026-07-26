# CI Evidence Contract

Every mandatory CI artifact must include or be named with `${GITHUB_SHA}` so the release decision can be traced to one immutable candidate.

Required evidence producers:

- `verify`: workspace build log.
- `postgres-integration`: migration/invariant result and clean restore report.
- `staging-smoke`: liveness/readiness and safe fault-injection report.
- `riyadh-e2e`: deterministic pilot result and readiness report.
- `operational-readiness`: final fail-closed gate decision.

The final gate runs with `if: always()` and explicitly rejects any upstream result other than `success`. Cancelled, skipped, missing, or failed work is not accepted as evidence.
