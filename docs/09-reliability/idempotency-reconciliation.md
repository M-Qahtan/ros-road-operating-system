# Idempotency Reservation Reconciliation Runbook

Status: engineering control for staging/pilot preparation. This runbook does not authorize direct production mutation without the applicable operational approval.

## Purpose

`idempotency_reservations` is a durable fail-closed fence around a logical command. A reservation is created before the command enters its mutation path and is deleted only after the protected operation—including persistence of the immutable replay record—returns successfully.

An operation error, database ambiguity, worker crash or process termination intentionally leaves the reservation in place. The request path must **never auto-expire or steal** that reservation, because the underlying RoadEvent mutation may already have committed even when the caller did not receive a result.

## Alert condition

Investigate a reservation when:

- the same idempotency key repeatedly returns `already in progress or requires reconciliation`;
- a process/worker restart occurred while a safety-critical command was executing;
- an idempotency reservation remains beyond the normal command execution envelope;
- a completed replay record exists while its reservation was not released;
- SRE/operations observes reservation growth inconsistent with request volume.

Age alone is not proof that a reservation is stale.

## Read-only evidence collection

Collect the exact scope/key and inspect both tables before any mutation:

```sql
SELECT scope, idempotency_key, fence_token, acquired_at
FROM idempotency_reservations
WHERE scope = $1 AND idempotency_key = $2;

SELECT scope, idempotency_key, fingerprint, response, created_at
FROM idempotency_records
WHERE scope = $1 AND idempotency_key = $2;
```

Then correlate the command with:

- RoadEvent current version/state;
- immutable `audit_logs` entries;
- `road_event_timeline` entries;
- corresponding `outbox_events` rows and publication state;
- trace/correlation identifiers from the originating request;
- worker/process restart or database-failure evidence.

Do not infer command failure merely because the caller received an error or disconnected.

## Safe reconciliation classes

### A. Completed replay record exists

If the immutable `idempotency_records` row exists and its fingerprint/result is consistent with the correlated domain/audit state, the command has a durable replay result. The leftover reservation is cleanup residue, not permission to re-execute the command.

After independent verification, operations may remove **only the exact reservation row** using its `fence_token`:

```sql
DELETE FROM idempotency_reservations
WHERE scope = $1
  AND idempotency_key = $2
  AND fence_token = $3::uuid;
```

A subsequent request must replay the immutable completed result or reject a different fingerprint.

### B. No replay record, but domain/audit proves the mutation committed

This is an ambiguous completion and remains fail closed. Do **not** delete the reservation and retry automatically. Reconstruct the canonical command result from authoritative state, review whether a replay record can be safely repaired through a separately reviewed recovery procedure, and record the reconciliation evidence. Until that recovery path is implemented and approved, escalate as a runtime incident.

### C. No replay record and evidence proves the mutation did not commit

Only after authoritative database/audit/outbox evidence proves that no logical side effect committed may the reservation be considered for release. The release decision must be recorded with the evidence used to prove non-commit. A new request may then use a fresh idempotency key unless policy explicitly permits retry of the original key.

### D. Outcome cannot be proven

Keep the reservation. Escalate. The safe state is blocked/review-required, not speculative retry.

## Prohibited recovery shortcuts

Never:

- delete reservations based only on age or a TTL;
- bulk-delete reservations;
- retry a command because an HTTP request timed out;
- rewrite an immutable completed idempotency record;
- bypass RoadEvent version, closure, S3/S4 or human-authority controls;
- treat an Outbox publish attempt as proof that the domain mutation did or did not commit;
- hide reconciliation by deleting audit/evidence rows.

## Required evidence for closure

For each reconciled safety-critical reservation retain:

- scope and idempotency key;
- fence token;
- originating trace/correlation IDs when available;
- before/after authoritative RoadEvent version/state;
- audit/timeline evidence;
- outbox evidence;
- replay record status;
- exact reconciliation classification (A/B/C/D);
- reviewer/operator decision and timestamp;
- any corrective change or incident reference.

## Production-readiness gate

Before `RUNTIME_READY_FOR_STAGING` can advance to a live production-readiness claim, automated failure tests must demonstrate at minimum:

1. concurrent equal requests execute one logical command;
2. crash before domain commit leaves a fail-closed reservation;
3. crash after domain commit but before replay persistence cannot trigger automatic re-execution;
4. completed replay survives process restart;
5. completed record + leftover reservation can be reconciled without re-running the command;
6. reservation accumulation is observable and alertable;
7. recovery cannot weaken tenant/purpose or S3/S4 human-authority boundaries.
