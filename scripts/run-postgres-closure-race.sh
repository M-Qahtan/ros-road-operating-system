#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE:?closure race proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE" \
  || -L "$ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE" \
  || -s "$ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE" ]]; then
  echo "PostgreSQL closure race proof target must be a new empty regular file" >&2
  exit 2
fi

readonly source_log="$(mktemp)"
readonly closure_log="$(mktemp)"
cleanup() { rm -f "$source_log" "$closure_log"; }
trap cleanup EXIT

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE road_events
SET status = 'RECOVERY', severity = 'S3', version = 2,
    closure_authorized_by = '20000000-0000-4000-8000-000000000001',
    closure_authorized_at = '2026-09-08T20:04:00Z',
    closure_authorization_reason = 'Human-reviewed local closure race fixture',
    closure_source_input_version = 2,
    closure_source_snapshot_digest = repeat('2', 64)
WHERE tenant_id = 'riyadh-pilot' AND purpose = 'road-safety-response'
  AND id = '10000000-0000-4000-8000-000000000001';
INSERT INTO road_event_revision_ledger (
  tenant_id, purpose, case_id, component, revision, digest, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001',
  'CASE', 2, repeat('c', 64), '2026-09-08T20:04:00Z'
);
COMMIT;
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$source_log" 2>&1 <<'SQL' &
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$
DECLARE current_status road_event_status;
BEGIN
  SELECT status INTO current_status FROM road_events
  WHERE tenant_id = 'riyadh-pilot' AND purpose = 'road-safety-response'
    AND id = '10000000-0000-4000-8000-000000000001'
  FOR UPDATE;
  IF current_status = 'CLOSED' THEN
    RAISE EXCEPTION 'Structured indicators cannot be appended after incident closure';
  END IF;
END;
$$;
SELECT pg_advisory_lock(20260909, 1);
SELECT pg_sleep(10);
INSERT INTO human_safety_indicator_revision_ledger (
  tenant_id, purpose, case_id, revision, indicator_set, digest,
  recorded_by, recorded_by_role, trace_id, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001', 3,
  '[{"kind":"DEVICE_AIRBAG","disposition":"UNKNOWN","confidence":0.75}]'::jsonb,
  repeat('8', 64), '20000000-0000-4000-8000-000000000001', 'OPERATOR',
  '30000000-0000-4000-8000-000000000004', '2026-09-08T20:04:01Z'
);
COMMIT;
SQL
readonly source_pid=$!

source_ready=false
for _ in $(seq 1 50); do
  if [[ "$(psql "$DATABASE_URL" -Atqc 'SELECT NOT pg_try_advisory_lock(20260909, 1)')" == "t" ]]; then
    source_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$source_ready" != true ]]; then
  wait "$source_pid" || true
  echo "Source-update participant never reached the locked race boundary" >&2
  exit 2
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$closure_log" 2>&1 <<'SQL' &
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
/* ros_brain_closure_race_participant */
DO $$
DECLARE snapshot_current boolean;
BEGIN
  PERFORM 1 FROM road_events
  WHERE tenant_id = 'riyadh-pilot' AND purpose = 'road-safety-response'
    AND id = '10000000-0000-4000-8000-000000000001'
  FOR UPDATE;
  SELECT EXISTS (
    SELECT 1 FROM ros_eye_safety_fusion_input_snapshots snapshot
    WHERE snapshot.tenant_id = 'riyadh-pilot'
      AND snapshot.purpose = 'road-safety-response'
      AND snapshot.case_id = '10000000-0000-4000-8000-000000000001'
      AND snapshot.input_version = 2
      AND snapshot.snapshot_digest = repeat('2', 64)
      AND snapshot.case_revision = 1 AND snapshot.case_digest = repeat('a', 64)
      AND snapshot.severity_revision = 1 AND snapshot.severity_digest = repeat('b', 64)
      AND snapshot.contact_revision IS NULL
      AND NOT EXISTS (SELECT 1 FROM ros_eye_contact_revision_ledger contact
        WHERE contact.tenant_id= snapshot.tenant_id AND contact.purpose=snapshot.purpose AND contact.case_id=snapshot.case_id)
      AND NOT EXISTS (SELECT 1 FROM ros_eye_contact_sessions session
        WHERE session.tenant_id=snapshot.tenant_id AND session.case_id=snapshot.case_id)
      AND snapshot.evidence_revision = (SELECT max(revision) FROM evidence_revision_ledger evidence
        WHERE evidence.tenant_id=snapshot.tenant_id AND evidence.purpose=snapshot.purpose AND evidence.case_id=snapshot.case_id)
      AND snapshot.indicator_revision = (SELECT max(revision) FROM human_safety_indicator_revision_ledger indicator
        WHERE indicator.tenant_id=snapshot.tenant_id AND indicator.purpose=snapshot.purpose AND indicator.case_id=snapshot.case_id)
  ) INTO snapshot_current;
  IF NOT snapshot_current THEN RAISE EXCEPTION 'SOURCE_SNAPSHOT_CHANGED'; END IF;
END;
$$;
UPDATE road_events SET status='CLOSED', version=3
WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
  AND id='10000000-0000-4000-8000-000000000001';
COMMIT;
SQL
readonly closure_pid=$!

closure_waiting=false
for _ in $(seq 1 100); do
  if [[ "$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%ros_brain_closure_race_participant%' AND wait_event_type='Lock'")" == "1" ]]; then
    closure_waiting=true
    break
  fi
  sleep 0.1
done
if [[ "$closure_waiting" != true ]]; then
  wait "$source_pid" || true
  wait "$closure_pid" || true
  echo "Closure participant was not observed waiting on the source row lock" >&2
  exit 2
fi

set +e
wait "$closure_pid"
closure_status=$?
wait "$source_pid"
source_status=$?
set -e

if [[ "$source_status" -ne 0 ]]; then
  echo "Source-update participant failed:" >&2
  cat "$source_log" >&2
  exit 2
fi
closure_output="$(cat "$closure_log")"
if [[ "$closure_status" -eq 0 || "$closure_output" != *"SOURCE_SNAPSHOT_CHANGED"* ]]; then
  echo "Closure participant did not lose safely after concurrent source drift" >&2
  echo "$closure_output" >&2
  exit 2
fi

race_state="$(psql "$DATABASE_URL" -Atqc "SELECT status::text || '|' || version::text || '|' || (SELECT max(revision)::text FROM human_safety_indicator_revision_ledger WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response' AND case_id='10000000-0000-4000-8000-000000000001') FROM road_events WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response' AND id='10000000-0000-4000-8000-000000000001'")"
if [[ "$race_state" != "RECOVERY|2|3" ]]; then
  echo "Closure/source race left an unsafe or ambiguous durable state: ${race_state}" >&2
  exit 2
fi

printf '%s\n' 'SOURCE_UPDATE' 'COMMITTED' 'CLOSURE' 'SOURCE_SNAPSHOT_CHANGED' \
  > "$ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE"
echo "PostgreSQL closure/source race passed with exactly one safe winner"
