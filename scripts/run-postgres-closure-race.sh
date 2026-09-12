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
readonly closure_winner_log="$(mktemp)"
readonly source_loser_log="$(mktemp)"
cleanup() { rm -f "$source_log" "$closure_log" "$closure_winner_log" "$source_loser_log"; }
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
      AND EXISTS (SELECT 1 FROM road_event_revision_ledger original_case
        WHERE original_case.tenant_id=snapshot.tenant_id AND original_case.purpose=snapshot.purpose
          AND original_case.case_id=snapshot.case_id AND original_case.component='CASE'
          AND original_case.revision=snapshot.case_revision AND original_case.digest=snapshot.case_digest)
      AND EXISTS (SELECT 1 FROM road_event_revision_ledger current_case
        WHERE current_case.tenant_id=snapshot.tenant_id AND current_case.purpose=snapshot.purpose
          AND current_case.case_id=snapshot.case_id AND current_case.component='CASE'
          AND current_case.revision=snapshot.case_revision + 1 AND current_case.digest=repeat('c', 64)
          AND current_case.revision=(SELECT max(revision) FROM road_event_revision_ledger latest_case
            WHERE latest_case.tenant_id=snapshot.tenant_id AND latest_case.purpose=snapshot.purpose
              AND latest_case.case_id=snapshot.case_id AND latest_case.component='CASE'))
      AND EXISTS (SELECT 1 FROM road_event_revision_ledger severity
        WHERE severity.tenant_id=snapshot.tenant_id AND severity.purpose=snapshot.purpose
          AND severity.case_id=snapshot.case_id AND severity.component='SEVERITY'
          AND severity.revision=snapshot.severity_revision AND severity.digest=snapshot.severity_digest
          AND severity.revision=(SELECT max(revision) FROM road_event_revision_ledger latest_severity
            WHERE latest_severity.tenant_id=snapshot.tenant_id AND latest_severity.purpose=snapshot.purpose
              AND latest_severity.case_id=snapshot.case_id AND latest_severity.component='SEVERITY'))
      AND snapshot.contact_revision IS NULL
      AND NOT EXISTS (SELECT 1 FROM ros_eye_contact_revision_ledger contact
        WHERE contact.tenant_id= snapshot.tenant_id AND contact.purpose=snapshot.purpose AND contact.case_id=snapshot.case_id)
      AND NOT EXISTS (SELECT 1 FROM ros_eye_contact_sessions session
        WHERE session.tenant_id=snapshot.tenant_id AND session.case_id=snapshot.case_id)
      AND EXISTS (SELECT 1 FROM evidence_revision_ledger evidence
        WHERE evidence.tenant_id=snapshot.tenant_id AND evidence.purpose=snapshot.purpose AND evidence.case_id=snapshot.case_id
          AND evidence.revision=snapshot.evidence_revision AND evidence.digest=snapshot.evidence_digest
          AND evidence.revision=(SELECT max(revision) FROM evidence_revision_ledger latest_evidence
            WHERE latest_evidence.tenant_id=snapshot.tenant_id AND latest_evidence.purpose=snapshot.purpose
              AND latest_evidence.case_id=snapshot.case_id))
      AND EXISTS (SELECT 1 FROM human_safety_indicator_revision_ledger indicator
        WHERE indicator.tenant_id=snapshot.tenant_id AND indicator.purpose=snapshot.purpose AND indicator.case_id=snapshot.case_id
          AND indicator.revision=snapshot.indicator_revision AND indicator.digest=snapshot.indicator_digest
          AND indicator.revision=(SELECT max(revision) FROM human_safety_indicator_revision_ledger latest_indicator
            WHERE latest_indicator.tenant_id=snapshot.tenant_id AND latest_indicator.purpose=snapshot.purpose
              AND latest_indicator.case_id=snapshot.case_id))
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
closure_loser_result=''
if [[ "$closure_output" == *"SOURCE_SNAPSHOT_CHANGED"* ]]; then
  closure_loser_result='SOURCE_SNAPSHOT_CHANGED'
elif [[ "$closure_output" == *"could not serialize access"* ]]; then
  closure_loser_result='SERIALIZATION_FAILURE'
fi
if [[ "$closure_status" -eq 0 || -z "$closure_loser_result" ]]; then
  echo "Closure participant did not lose safely after concurrent source drift" >&2
  echo "$closure_output" >&2
  exit 2
fi

race_state="$(psql "$DATABASE_URL" -Atqc "SELECT status::text || '|' || version::text || '|' || (SELECT max(revision)::text FROM human_safety_indicator_revision_ledger WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response' AND case_id='10000000-0000-4000-8000-000000000001') FROM road_events WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response' AND id='10000000-0000-4000-8000-000000000001'")"
if [[ "$race_state" != "RECOVERY|2|3" ]]; then
  echo "Closure/source race left an unsafe or ambiguous durable state: ${race_state}" >&2
  exit 2
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
INSERT INTO road_events (
  id, tenant_id, purpose, status, severity, severity_score, confidence, reason_codes,
  severity_requires_human_review, location, occurred_at, version
) VALUES (
  '10000000-0000-4000-8000-000000000002', 'riyadh-pilot', 'road-safety-response',
  'RECOVERY', 'S3', 75, 0.850, ARRAY['closure_wins_race_fixture'], true,
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography,
  '2026-09-08T20:05:00Z', 1
);
INSERT INTO road_event_revision_ledger (
  tenant_id, purpose, case_id, component, revision, digest, recorded_at
) VALUES
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000002', 'CASE', 1, repeat('a', 64), '2026-09-08T20:05:00Z'),
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000002', 'SEVERITY', 1, repeat('b', 64), '2026-09-08T20:05:00Z');
INSERT INTO evidence_revision_ledger (
  tenant_id, purpose, case_id, revision, digest, recorded_at
) VALUES ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000002', 1, repeat('d', 64), '2026-09-08T20:05:00Z');
INSERT INTO human_safety_indicator_revision_ledger (
  tenant_id, purpose, case_id, revision, indicator_set, digest,
  recorded_by, recorded_by_role, trace_id, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000002', 1,
  '[{"kind":"DEVICE_AIRBAG","disposition":"PRESENT","confidence":0.91}]'::jsonb,
  repeat('e', 64), '20000000-0000-4000-8000-000000000001', 'OPERATOR',
  '30000000-0000-4000-8000-000000000005', '2026-09-08T20:05:00Z'
);
INSERT INTO ros_eye_safety_fusion_input_snapshots (
  tenant_id, purpose, case_id, input_version, policy_version, captured_at,
  case_revision, case_digest, severity_revision, severity_digest,
  contact_revision, contact_digest, evidence_revision, evidence_digest,
  indicator_revision, indicator_digest, snapshot_digest
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000002',
  1, 'ros-eye.input-snapshot.v1', '2026-09-08T20:05:01Z',
  1, repeat('a', 64), 1, repeat('b', 64), NULL, NULL,
  1, repeat('d', 64), 1, repeat('e', 64), repeat('3', 64)
);
UPDATE road_events
SET version=2,
    closure_authorized_by='20000000-0000-4000-8000-000000000001',
    closure_authorized_at='2026-09-08T20:05:02Z',
    closure_authorization_reason='Human-reviewed local reverse closure race fixture',
    closure_source_input_version=1,
    closure_source_snapshot_digest=repeat('3', 64)
WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
  AND id='10000000-0000-4000-8000-000000000002';
INSERT INTO road_event_revision_ledger (
  tenant_id, purpose, case_id, component, revision, digest, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000002',
  'CASE', 2, repeat('c', 64), '2026-09-08T20:05:02Z'
);
COMMIT;
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$closure_winner_log" 2>&1 <<'SQL' &
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$
DECLARE snapshot_current boolean;
BEGIN
  PERFORM 1 FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000002'
  FOR UPDATE;
  SELECT EXISTS (
    SELECT 1 FROM ros_eye_safety_fusion_input_snapshots snapshot
    WHERE snapshot.tenant_id='riyadh-pilot' AND snapshot.purpose='road-safety-response'
      AND snapshot.case_id='10000000-0000-4000-8000-000000000002'
      AND snapshot.input_version=1 AND snapshot.snapshot_digest=repeat('3', 64)
      AND snapshot.case_revision=1 AND snapshot.case_digest=repeat('a', 64)
      AND snapshot.severity_revision=1 AND snapshot.severity_digest=repeat('b', 64)
      AND EXISTS (SELECT 1 FROM road_event_revision_ledger original_case
        WHERE original_case.tenant_id=snapshot.tenant_id AND original_case.purpose=snapshot.purpose
          AND original_case.case_id=snapshot.case_id AND original_case.component='CASE'
          AND original_case.revision=snapshot.case_revision AND original_case.digest=snapshot.case_digest)
      AND EXISTS (SELECT 1 FROM road_event_revision_ledger current_case
        WHERE current_case.tenant_id=snapshot.tenant_id AND current_case.purpose=snapshot.purpose
          AND current_case.case_id=snapshot.case_id AND current_case.component='CASE'
          AND current_case.revision=snapshot.case_revision + 1 AND current_case.digest=repeat('c', 64)
          AND current_case.revision=(SELECT max(revision) FROM road_event_revision_ledger latest_case
            WHERE latest_case.tenant_id=snapshot.tenant_id AND latest_case.purpose=snapshot.purpose
              AND latest_case.case_id=snapshot.case_id AND latest_case.component='CASE'))
      AND EXISTS (SELECT 1 FROM road_event_revision_ledger severity
        WHERE severity.tenant_id=snapshot.tenant_id AND severity.purpose=snapshot.purpose
          AND severity.case_id=snapshot.case_id AND severity.component='SEVERITY'
          AND severity.revision=snapshot.severity_revision AND severity.digest=snapshot.severity_digest
          AND severity.revision=(SELECT max(revision) FROM road_event_revision_ledger latest_severity
            WHERE latest_severity.tenant_id=snapshot.tenant_id AND latest_severity.purpose=snapshot.purpose
              AND latest_severity.case_id=snapshot.case_id AND latest_severity.component='SEVERITY'))
      AND snapshot.contact_revision IS NULL
      AND NOT EXISTS (SELECT 1 FROM ros_eye_contact_revision_ledger contact
        WHERE contact.tenant_id=snapshot.tenant_id AND contact.purpose=snapshot.purpose AND contact.case_id=snapshot.case_id)
      AND NOT EXISTS (SELECT 1 FROM ros_eye_contact_sessions session
        WHERE session.tenant_id=snapshot.tenant_id AND session.case_id=snapshot.case_id)
      AND EXISTS (SELECT 1 FROM evidence_revision_ledger evidence
        WHERE evidence.tenant_id=snapshot.tenant_id AND evidence.purpose=snapshot.purpose AND evidence.case_id=snapshot.case_id
          AND evidence.revision=snapshot.evidence_revision AND evidence.digest=snapshot.evidence_digest
          AND evidence.revision=(SELECT max(revision) FROM evidence_revision_ledger latest_evidence
            WHERE latest_evidence.tenant_id=snapshot.tenant_id AND latest_evidence.purpose=snapshot.purpose
              AND latest_evidence.case_id=snapshot.case_id))
      AND EXISTS (SELECT 1 FROM human_safety_indicator_revision_ledger indicator
        WHERE indicator.tenant_id=snapshot.tenant_id AND indicator.purpose=snapshot.purpose AND indicator.case_id=snapshot.case_id
          AND indicator.revision=snapshot.indicator_revision AND indicator.digest=snapshot.indicator_digest
          AND indicator.revision=(SELECT max(revision) FROM human_safety_indicator_revision_ledger latest_indicator
            WHERE latest_indicator.tenant_id=snapshot.tenant_id AND latest_indicator.purpose=snapshot.purpose
              AND latest_indicator.case_id=snapshot.case_id))
  ) INTO snapshot_current;
  IF NOT snapshot_current THEN RAISE EXCEPTION 'SOURCE_SNAPSHOT_CHANGED'; END IF;
END;
$$;
SELECT pg_advisory_lock(20260909, 2);
SELECT pg_sleep(10);
UPDATE road_events SET status='CLOSED', version=3
WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
  AND id='10000000-0000-4000-8000-000000000002';
COMMIT;
SQL
readonly closure_winner_pid=$!

closure_ready=false
for _ in $(seq 1 50); do
  if [[ "$(psql "$DATABASE_URL" -Atqc 'SELECT NOT pg_try_advisory_lock(20260909, 2)')" == "t" ]]; then
    closure_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$closure_ready" != true ]]; then
  wait "$closure_winner_pid" || true
  echo "Closure winner never reached the locked reverse-race boundary" >&2
  exit 2
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$source_loser_log" 2>&1 <<'SQL' &
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
/* ros_brain_source_race_participant */
DO $$
DECLARE current_status road_event_status;
BEGIN
  SELECT status INTO current_status FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000002'
  FOR UPDATE;
  IF current_status='CLOSED' THEN
    RAISE EXCEPTION 'Structured indicators cannot be appended after incident closure';
  END IF;
END;
$$;
INSERT INTO human_safety_indicator_revision_ledger (
  tenant_id, purpose, case_id, revision, indicator_set, digest,
  recorded_by, recorded_by_role, trace_id, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000002', 2,
  '[{"kind":"DEVICE_AIRBAG","disposition":"ABSENT","confidence":0.96}]'::jsonb,
  repeat('9', 64), '20000000-0000-4000-8000-000000000001', 'OPERATOR',
  '30000000-0000-4000-8000-000000000006', '2026-09-08T20:05:03Z'
);
COMMIT;
SQL
readonly source_loser_pid=$!

source_waiting=false
for _ in $(seq 1 100); do
  if [[ "$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%ros_brain_source_race_participant%' AND wait_event_type='Lock'")" == "1" ]]; then
    source_waiting=true
    break
  fi
  sleep 0.1
done
if [[ "$source_waiting" != true ]]; then
  wait "$closure_winner_pid" || true
  wait "$source_loser_pid" || true
  echo "Source participant was not observed waiting on the closure row lock" >&2
  exit 2
fi

set +e
wait "$closure_winner_pid"
closure_winner_status=$?
wait "$source_loser_pid"
source_loser_status=$?
set -e
source_loser_output="$(cat "$source_loser_log")"
if [[ "$closure_winner_status" -ne 0 ]]; then
  echo "Closure winner failed:" >&2
  cat "$closure_winner_log" >&2
  exit 2
fi
source_loser_result=''
if [[ "$source_loser_output" == *"Structured indicators cannot be appended after incident closure"* ]]; then
  source_loser_result='INCIDENT_CLOSED'
elif [[ "$source_loser_output" == *"could not serialize access"* ]]; then
  source_loser_result='SERIALIZATION_FAILURE'
fi
if [[ "$source_loser_status" -eq 0 || -z "$source_loser_result" ]]; then
  echo "Source participant did not lose safely after concurrent closure" >&2
  echo "$source_loser_output" >&2
  exit 2
fi

reverse_race_state="$(psql "$DATABASE_URL" -Atqc "SELECT status::text || '|' || version::text || '|' || (SELECT max(revision)::text FROM human_safety_indicator_revision_ledger WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response' AND case_id='10000000-0000-4000-8000-000000000002') FROM road_events WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response' AND id='10000000-0000-4000-8000-000000000002'")"
if [[ "$reverse_race_state" != "CLOSED|3|1" ]]; then
  echo "Reverse closure/source race left an unsafe or ambiguous durable state: ${reverse_race_state}" >&2
  exit 2
fi

printf '%s\n' \
  'SOURCE_UPDATE' 'COMMITTED' 'CLOSURE' "$closure_loser_result" \
  'CLOSURE' 'COMMITTED' 'SOURCE_UPDATE' "$source_loser_result" \
  > "$ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE"
echo "PostgreSQL closure/source races passed with exactly one safe winner in each ordering"
