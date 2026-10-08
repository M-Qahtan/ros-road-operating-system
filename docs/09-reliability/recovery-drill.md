# PostgreSQL/PostGIS recovery drill

## Objective

Prove that the Riyadh MVP database can be backed up and restored into a clean database without losing schema, PostGIS capability, persistence invariants, or audit history.

## Engineering targets

- RPO target: 5 minutes for the pilot engineering environment.
- RTO target: 30 minutes for a verified clean restore.

These are internal MVP engineering targets, not public service commitments.

## Drill procedure

1. Provision an isolated PostgreSQL/PostGIS instance with generated test-only credentials.
2. Apply every migration in order and run persistence invariants.
3. Create a logical backup using the approved script.
4. Provision a separate empty restore database.
5. Restore the backup with `scripts/postgres-restore-verify.sh`.
6. Verify PostGIS extensions, tables, constraints, indexes, event versions, outbox records, evidence metadata, and audit records.
7. Record elapsed restore time and candidate head/base/tested merge SHAs.
8. Destroy the isolated databases and credentials after evidence capture.

## Failure conditions

The drill fails and blocks release when the backup is missing or empty, restore exits nonzero, schema or PostGIS checks differ, durable records cannot be queried, audit history is incomplete, the RTO is exceeded, or evidence cannot be tied to the tested candidate.

## Production boundary

This automated drill does not access production data. Production recovery requires an approved runbook, designated incident command, privacy and security oversight, backup-key access, and explicit restoration authorization.

## Isolated CI durable round-trip fixture

Requirement: restored PostgreSQL state must preserve scoped RoadEvent data, PostGIS
coordinates, transactional Outbox, append-only Audit, immutable command replay,
and an outstanding idempotency fence. Hazard: a schema-only restore check may
return PASS while safety-critical durable records are missing or altered.

The Operational Readiness PostgreSQL job uses generated test-only credentials
and an isolated service. After migration and persistence checks, it seeds
`scripts/fixtures/postgres-recovery-seed.sql`, verifies the source with
`scripts/fixtures/postgres-recovery-assert.sql`, creates a SHA-256-digested
logical backup, restores into a separate empty database, and repeats the
assertions on the restored state. Any missing or altered record fails closed.
The restore timer includes the post-restore assertions.

Evidence: `artifacts/reliability/postgres-restore.log` and
`postgres-recovery.json`, tied to candidate head/base/tested merge SHAs by the
existing CI evidence manifest. The JSON records `dataRoundTrip` only after
successful assertions, and `rpoStatus=UNVERIFIED_REQUIRES_CONTROLLED_SOURCE_TIMESTAMP`.
The five-minute RPO is a target, **not** a measured achievement. This drill
does not prove production RPO, long-duration durability, or field readiness.
Independent Safety/Security review and all other release gates remain mandatory.
