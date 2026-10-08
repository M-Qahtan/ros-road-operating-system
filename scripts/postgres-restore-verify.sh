#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must be set}"
: "${BACKUP_FILE:?BACKUP_FILE must be set}"

# Fail closed if the backup payload is not exactly the artifact that was digested.
sha256sum -c "$BACKUP_FILE.sha256"

restore_started_at="$(date +%s)"
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-privileges "$BACKUP_FILE"
restore_finished_at="$(date +%s)"
restore_duration_seconds="$((restore_finished_at - restore_started_at))"

assert_regclass() {
  local relation="$1"
  psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
    "SELECT to_regclass('public.${relation}') IS NOT NULL" | grep -qx t
}

# These relations represent the minimum durable runtime invariants. A restore that
# only recreates the headline event/audit tables is not sufficient evidence.
for relation in \
  road_events \
  road_event_timeline \
  outbox_events \
  processed_integration_events \
  audit_logs \
  idempotency_records \
  idempotency_reservations; do
  assert_regclass "$relation"
done

# Verify the fail-closed/append-only database protections survived restoration.
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT EXISTS (
     SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.audit_logs'::regclass
       AND tgname = 'audit_logs_immutable'
       AND NOT tgisinternal
   )" | grep -qx t

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT EXISTS (
     SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.idempotency_records'::regclass
       AND tgname = 'idempotency_records_immutable'
       AND NOT tgisinternal
   )" | grep -qx t

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT EXISTS (
     SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.idempotency_reservations'::regclass
       AND tgname = 'idempotency_reservations_no_update'
       AND NOT tgisinternal
   )" | grep -qx t

# Check restored catalog integrity. This does not claim field proof or RPO compliance;
# those require a controlled evidence run with source timestamps and an independent review.
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace" \
  | grep -Eq '^[1-9][0-9]*$'

backup_sha256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
printf 'PostgreSQL restore verification passed\n'
printf 'backup_sha256=%s\n' "$backup_sha256"
printf 'restore_duration_seconds=%s\n' "$restore_duration_seconds"
printf 'rpo_status=UNVERIFIED_REQUIRES_CONTROLLED_SOURCE_TIMESTAMP\n'
printf 'field_evidence=NONE\n'
