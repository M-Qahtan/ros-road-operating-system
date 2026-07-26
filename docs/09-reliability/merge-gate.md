# Merge Gate

This branch is ready for review only after GitHub Actions proves:

- `verify` succeeds;
- `postgres-integration` succeeds, including clean restore and RTO check;
- `staging-smoke` succeeds, including safe Redis and MinIO fault injection;
- `riyadh-e2e` succeeds;
- `operational-readiness` succeeds after requiring every upstream result.

Any missing, skipped, cancelled, or failed job blocks merge.
