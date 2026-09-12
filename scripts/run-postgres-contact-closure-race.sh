#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_CONTACT_CLOSURE_RACE_PROOF_FILE:?contact/closure race proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_CONTACT_CLOSURE_RACE_PROOF_FILE" \
  || -L "$ROS_POSTGRES_CONTACT_CLOSURE_RACE_PROOF_FILE" \
  || -s "$ROS_POSTGRES_CONTACT_CLOSURE_RACE_PROOF_FILE" ]]; then
  echo "PostgreSQL contact/closure race proof target must be a new empty regular file" >&2
  exit 2
fi

readonly command_log="$(mktemp)"
readonly closure_log="$(mktemp)"
readonly closure_winner_log="$(mktemp)"
readonly command_loser_log="$(mktemp)"
cleanup() { rm -f "$command_log" "$closure_log" "$closure_winner_log" "$command_loser_log"; }
trap cleanup EXIT

seed_case() {
  local case_id="$1" session_id="$2" digest="$3" occurred_at="$4"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -v case_id="$case_id" -v session_id="$session_id" -v snapshot_digest="$digest" -v occurred_at="$occurred_at" <<'SQL'
BEGIN;
INSERT INTO road_events (
  id, tenant_id, purpose, status, severity, severity_score, confidence, reason_codes,
  severity_requires_human_review, location, occurred_at, version
) VALUES (
  :'case_id', 'riyadh-pilot', 'road-safety-response', 'RECOVERY', 'S3', 75, 0.850,
  ARRAY['contact_closure_race_fixture'], true,
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography, :'occurred_at', 2
);
INSERT INTO road_event_revision_ledger (tenant_id, purpose, case_id, component, revision, digest, recorded_at)
VALUES
  ('riyadh-pilot', 'road-safety-response', :'case_id', 'CASE', 1, repeat('a', 64), :'occurred_at'),
  ('riyadh-pilot', 'road-safety-response', :'case_id', 'CASE', 2, repeat('c', 64), :'occurred_at'),
  ('riyadh-pilot', 'road-safety-response', :'case_id', 'SEVERITY', 1, repeat('b', 64), :'occurred_at');
INSERT INTO ros_eye_contact_sessions (
  tenant_id, case_id, session_id, state, version, protocol_version, prompt_policy_version,
  accessibility_policy_version, language, identity_confidence, attempt_count,
  last_interaction_at, automation_suppressed, accessibility, updated_at
) VALUES (
  'riyadh-pilot', :'case_id', :'session_id', 'HUMAN_REVIEW', 1,
  'contact.v1', 'prompt.v1', 'accessibility.v1', 'ar', 'UNVERIFIED', 0,
  :'occurred_at', true, '{}'::jsonb, :'occurred_at'
);
INSERT INTO ros_eye_contact_revision_ledger (
  tenant_id, purpose, case_id, revision, status, digest, recorded_at
) VALUES ('riyadh-pilot', 'road-safety-response', :'case_id', 1, 'PRESENT', repeat('f', 64), :'occurred_at');
INSERT INTO evidence_revision_ledger (tenant_id, purpose, case_id, revision, digest, recorded_at)
VALUES ('riyadh-pilot', 'road-safety-response', :'case_id', 1, repeat('d', 64), :'occurred_at');
INSERT INTO human_safety_indicator_revision_ledger (
  tenant_id, purpose, case_id, revision, indicator_set, digest,
  recorded_by, recorded_by_role, trace_id, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', :'case_id', 1,
  '[{"kind":"DEVICE_AIRBAG","disposition":"PRESENT","confidence":0.91}]'::jsonb,
  repeat('e', 64), '20000000-0000-4000-8000-000000000001', 'OPERATOR',
  gen_random_uuid(), :'occurred_at'
);
INSERT INTO ros_eye_safety_fusion_input_snapshots (
  tenant_id, purpose, case_id, input_version, policy_version, captured_at,
  case_revision, case_digest, severity_revision, severity_digest,
  contact_revision, contact_digest, evidence_revision, evidence_digest,
  indicator_revision, indicator_digest, snapshot_digest
) VALUES (
  'riyadh-pilot', 'road-safety-response', :'case_id', 1, 'ros-eye.input-snapshot.v1', :'occurred_at',
  1, repeat('a', 64), 1, repeat('b', 64), 1, repeat('f', 64),
  1, repeat('d', 64), 1, repeat('e', 64), :'snapshot_digest'
);
UPDATE road_events SET
  closure_authorized_by='20000000-0000-4000-8000-000000000001',
  closure_authorized_at=:'occurred_at',
  closure_authorization_reason='Human-reviewed contact/closure race fixture',
  closure_source_input_version=1,
  closure_source_snapshot_digest=:'snapshot_digest'
WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response' AND id=:'case_id';
COMMIT;
SQL
}

seed_case '10000000-0000-4000-8000-000000000003' 'contact-race-command-wins' "$(printf '4%.0s' {1..64})" '2026-09-08T20:06:00Z'

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$command_log" 2>&1 <<'SQL' &
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$ DECLARE parent_status road_event_status; parent_version integer; BEGIN
  SELECT status, version INTO parent_status, parent_version FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000003' FOR UPDATE;
  IF parent_status='CLOSED' THEN RAISE EXCEPTION 'INCIDENT_CLOSED'; END IF;
  IF parent_version<>2 THEN RAISE EXCEPTION 'PARENT_VERSION_CONFLICT'; END IF;
END $$;
SELECT pg_advisory_lock(20260909, 3);
SELECT pg_sleep(10);
UPDATE ros_eye_contact_sessions SET state='ESCALATED', version=2, updated_at='2026-09-08T20:06:01Z'
WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000003'
  AND session_id='contact-race-command-wins' AND version=1;
INSERT INTO ros_eye_contact_revision_ledger (tenant_id, purpose, case_id, revision, status, digest, recorded_at)
VALUES ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000003', 2, 'PRESENT', repeat('9', 64), '2026-09-08T20:06:01Z');
COMMIT;
SQL
readonly command_pid=$!

for _ in $(seq 1 50); do
  [[ "$(psql "$DATABASE_URL" -Atqc 'SELECT NOT pg_try_advisory_lock(20260909, 3)')" == t ]] && command_ready=true && break
  sleep 0.1
done
if [[ "${command_ready:-false}" != true ]]; then wait "$command_pid" || true; echo "Contact command never reached its race boundary" >&2; exit 2; fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$closure_log" 2>&1 <<'SQL' &
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
/* ros_brain_contact_closure_waiter */
DO $$ DECLARE contact_current boolean; BEGIN
  PERFORM 1 FROM road_events WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000003' FOR UPDATE;
  SELECT EXISTS (
    SELECT 1 FROM ros_eye_safety_fusion_input_snapshots snapshot
    WHERE snapshot.tenant_id='riyadh-pilot' AND snapshot.purpose='road-safety-response'
      AND snapshot.case_id='10000000-0000-4000-8000-000000000003'
      AND snapshot.contact_revision=1 AND snapshot.contact_digest=repeat('f', 64)
      AND snapshot.contact_revision=(SELECT max(revision) FROM ros_eye_contact_revision_ledger latest
        WHERE latest.tenant_id=snapshot.tenant_id AND latest.purpose=snapshot.purpose AND latest.case_id=snapshot.case_id)
  ) INTO contact_current;
  IF NOT contact_current THEN RAISE EXCEPTION 'SOURCE_SNAPSHOT_CHANGED'; END IF;
END $$;
UPDATE road_events SET status='CLOSED', version=3 WHERE tenant_id='riyadh-pilot'
  AND purpose='road-safety-response' AND id='10000000-0000-4000-8000-000000000003';
COMMIT;
SQL
readonly closure_pid=$!

for _ in $(seq 1 100); do
  [[ "$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%ros_brain_contact_closure_waiter%' AND wait_event_type='Lock'")" == 1 ]] && closure_waiting=true && break
  sleep 0.1
done
if [[ "${closure_waiting:-false}" != true ]]; then wait "$command_pid" || true; wait "$closure_pid" || true; echo "Closure was not observed waiting on the contact command" >&2; exit 2; fi

set +e; wait "$closure_pid"; closure_status=$?; wait "$command_pid"; command_status=$?; set -e
closure_output="$(cat "$closure_log")"; closure_result=''
[[ "$closure_output" == *SOURCE_SNAPSHOT_CHANGED* ]] && closure_result=SOURCE_SNAPSHOT_CHANGED
[[ "$closure_output" == *"could not serialize access"* ]] && closure_result=SERIALIZATION_FAILURE
if [[ "$command_status" -ne 0 || "$closure_status" -eq 0 || -z "$closure_result" ]]; then echo "Contact-command winner race was not fail-closed" >&2; cat "$command_log" "$closure_log" >&2; exit 2; fi
command_race_state="$(psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || session.version::text || '|' || max(ledger.revision)::text FROM road_events event JOIN ros_eye_contact_sessions session ON session.tenant_id=event.tenant_id AND session.case_id=event.id::text JOIN ros_eye_contact_revision_ledger ledger ON ledger.tenant_id=event.tenant_id AND ledger.purpose=event.purpose AND ledger.case_id=event.id WHERE event.id='10000000-0000-4000-8000-000000000003' GROUP BY event.status,event.version,session.version")"
[[ "$command_race_state" == 'RECOVERY|2|2|2' ]] || { echo "Unsafe command-winner state: $command_race_state" >&2; exit 2; }

seed_case '10000000-0000-4000-8000-000000000004' 'contact-race-closure-wins' "$(printf '5%.0s' {1..64})" '2026-09-08T20:07:00Z'

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$closure_winner_log" 2>&1 <<'SQL' &
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT 1 FROM road_events WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
  AND id='10000000-0000-4000-8000-000000000004' FOR UPDATE;
SELECT pg_advisory_lock(20260909, 4);
SELECT pg_sleep(10);
UPDATE road_events SET status='CLOSED', version=3 WHERE tenant_id='riyadh-pilot'
  AND purpose='road-safety-response' AND id='10000000-0000-4000-8000-000000000004';
COMMIT;
SQL
readonly closure_winner_pid=$!
for _ in $(seq 1 50); do
  [[ "$(psql "$DATABASE_URL" -Atqc 'SELECT NOT pg_try_advisory_lock(20260909, 4)')" == t ]] && closure_ready=true && break
  sleep 0.1
done
if [[ "${closure_ready:-false}" != true ]]; then wait "$closure_winner_pid" || true; echo "Closure never reached its contact race boundary" >&2; exit 2; fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$command_loser_log" 2>&1 <<'SQL' &
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
/* ros_brain_contact_command_waiter */
DO $$ DECLARE parent_status road_event_status; BEGIN
  SELECT status INTO parent_status FROM road_events WHERE tenant_id='riyadh-pilot'
    AND purpose='road-safety-response' AND id='10000000-0000-4000-8000-000000000004' FOR UPDATE;
  IF parent_status='CLOSED' THEN RAISE EXCEPTION 'INCIDENT_CLOSED'; END IF;
END $$;
UPDATE ros_eye_contact_sessions SET state='ESCALATED', version=2, updated_at='2026-09-08T20:07:01Z'
WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004'
  AND session_id='contact-race-closure-wins' AND version=1;
INSERT INTO ros_eye_contact_revision_ledger (tenant_id, purpose, case_id, revision, status, digest, recorded_at)
VALUES ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000004', 2, 'PRESENT', repeat('9', 64), '2026-09-08T20:07:01Z');
COMMIT;
SQL
readonly command_loser_pid=$!
for _ in $(seq 1 100); do
  [[ "$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%ros_brain_contact_command_waiter%' AND wait_event_type='Lock'")" == 1 ]] && command_waiting=true && break
  sleep 0.1
done
if [[ "${command_waiting:-false}" != true ]]; then wait "$closure_winner_pid" || true; wait "$command_loser_pid" || true; echo "Contact command was not observed waiting on closure" >&2; exit 2; fi

set +e; wait "$closure_winner_pid"; closure_winner_status=$?; wait "$command_loser_pid"; command_loser_status=$?; set -e
command_loser_output="$(cat "$command_loser_log")"; command_loser_result=''
[[ "$command_loser_output" == *INCIDENT_CLOSED* ]] && command_loser_result=INCIDENT_CLOSED
[[ "$command_loser_output" == *"could not serialize access"* ]] && command_loser_result=SERIALIZATION_FAILURE
if [[ "$closure_winner_status" -ne 0 || "$command_loser_status" -eq 0 || -z "$command_loser_result" ]]; then echo "Closure-winner contact race was not fail-closed" >&2; cat "$closure_winner_log" "$command_loser_log" >&2; exit 2; fi
closure_race_state="$(psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || session.version::text || '|' || max(ledger.revision)::text FROM road_events event JOIN ros_eye_contact_sessions session ON session.tenant_id=event.tenant_id AND session.case_id=event.id::text JOIN ros_eye_contact_revision_ledger ledger ON ledger.tenant_id=event.tenant_id AND ledger.purpose=event.purpose AND ledger.case_id=event.id WHERE event.id='10000000-0000-4000-8000-000000000004' GROUP BY event.status,event.version,session.version")"
[[ "$closure_race_state" == 'CLOSED|3|1|1' ]] || { echo "Unsafe closure-winner state: $closure_race_state" >&2; exit 2; }

printf '%s\n' \
  CONTACT_COMMAND COMMITTED CLOSURE "$closure_result" \
  CLOSURE COMMITTED CONTACT_COMMAND "$command_loser_result" \
  > "$ROS_POSTGRES_CONTACT_CLOSURE_RACE_PROOF_FILE"
echo "PostgreSQL contact-command/closure races passed with one safe winner in each ordering"
