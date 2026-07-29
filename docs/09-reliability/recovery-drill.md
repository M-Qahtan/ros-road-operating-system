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
