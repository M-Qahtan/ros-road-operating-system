# Repeatable Recovery Drill

## PostgreSQL

1. Apply migrations and deterministic seed data.
2. Create a checksum-protected backup.
3. Create a clean restore database.
4. Restore with `scripts/postgres-restore-verify.sh`.
5. Verify RoadEvent and audit tables.
6. Record elapsed recovery time and compare with the 30-minute RTO.
7. Fail the release when checksum, restore, schema verification, or RTO fails.

## Evidence objects

1. Mirror the test bucket to isolated backup storage.
2. Record object count and checksums.
3. Restore into a clean bucket.
4. Compare count and checksums.
5. Verify metadata remains event-scoped.
6. Compare against 15-minute RPO and 60-minute RTO targets.

## Outbox replay

1. Stop the delivery dependency after durable intent is created.
2. Verify pending state is visible and no intent is marked delivered.
3. Restore the dependency.
4. Replay with bounded retry.
5. Reconcile exactly-once operational intent through idempotent consumers.

All drill outputs are engineering evidence tied to the commit SHA and contain no prohibited observability data.
