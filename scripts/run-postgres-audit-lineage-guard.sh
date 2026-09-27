#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_AUDIT_LINEAGE_PROOF_FILE:?audit lineage proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_AUDIT_LINEAGE_PROOF_FILE" \
  || -L "$ROS_POSTGRES_AUDIT_LINEAGE_PROOF_FILE" \
  || -s "$ROS_POSTGRES_AUDIT_LINEAGE_PROOF_FILE" ]]; then
  echo "Audit lineage proof target must be a new empty regular file" >&2
  exit 2
fi

readonly supervisor_id='30000000-0000-4000-8000-000000000003'
readonly fixture="${ROS_POSTGRES_AUDIT_LINEAGE_FIXTURE:-INITIAL}"
case "$fixture" in
  INITIAL)
    readonly authorization_event_id='30000000-0000-4000-8000-000000000001'
    readonly forged_closure_event_id='30000000-0000-4000-8000-000000000002'
    readonly authorization_trace_id='30000000-0000-4000-8000-000000000004'
    readonly forged_closure_trace_id='30000000-0000-4000-8000-000000000005'
    readonly valid_closure_trace_id='30000000-0000-4000-8000-000000000006'
    readonly duplicate_closure_trace_id='30000000-0000-4000-8000-000000000007'
    readonly authorization_occurred_at='2026-09-27T00:00:00Z'
    readonly authorization_state_at='2026-09-27T00:00:00.000Z'
    readonly forged_closure_occurred_at='2026-09-27T00:00:01Z'
    readonly first_racer_occurred_at='2026-09-27T00:00:02Z'
    readonly second_racer_occurred_at='2026-09-27T00:00:03Z'
    ;;
  RECOVERY)
    readonly authorization_event_id='40000000-0000-4000-8000-000000000001'
    readonly forged_closure_event_id='40000000-0000-4000-8000-000000000002'
    readonly authorization_trace_id='40000000-0000-4000-8000-000000000004'
    readonly forged_closure_trace_id='40000000-0000-4000-8000-000000000005'
    readonly valid_closure_trace_id='40000000-0000-4000-8000-000000000006'
    readonly duplicate_closure_trace_id='40000000-0000-4000-8000-000000000007'
    readonly authorization_occurred_at='2026-09-27T01:00:00Z'
    readonly authorization_state_at='2026-09-27T01:00:00.000Z'
    readonly forged_closure_occurred_at='2026-09-27T01:00:01Z'
    readonly first_racer_occurred_at='2026-09-27T01:00:02Z'
    readonly second_racer_occurred_at='2026-09-27T01:00:03Z'
    ;;
  *)
    echo "Unsupported audit lineage fixture '$fixture'" >&2
    exit 2
    ;;
esac
readonly error_log="$(mktemp)"
readonly first_racer_error_log="$(mktemp)"
readonly second_racer_error_log="$(mktemp)"

cleanup() {
  rm -f "$error_log" "$first_racer_error_log" "$second_racer_error_log"
}
trap cleanup EXIT

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<SQL
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id, correlation_id, causation_id,
  occurred_at
) VALUES (
  'SUPERVISOR', '$supervisor_id',
  'road_event.closure_authorized', 'RoadEvent', '$authorization_event_id',
  '{"status":"RECOVERY","version":12,"closureAuthorization":null}'::jsonb,
  '{"status":"RECOVERY","version":13,"closureAuthorization":{"actorId":"$supervisor_id","reason":"Cross-incident lineage guard fixture","authorizedAt":"$authorization_state_at","sourceSnapshot":{"inputVersion":1,"snapshotDigest":"1111111111111111111111111111111111111111111111111111111111111111","policyVersion":"ros-eye.input-snapshot.v2","cognitiveRevision":1,"cognitiveDigest":"6666666666666666666666666666666666666666666666666666666666666666"}}}'::jsonb,
  'Cross-incident lineage guard fixture', '$authorization_trace_id',
  '$authorization_event_id', NULL, '$authorization_occurred_at'
);
SQL

if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At > /dev/null 2>"$error_log" <<SQL
\set VERBOSITY verbose
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id, correlation_id, causation_id,
  occurred_at
) VALUES (
  'SUPERVISOR', '$supervisor_id',
  'road_event.closed', 'RoadEvent', '$forged_closure_event_id',
  '{"status":"RECOVERY","version":13,"closureAuthorization":{"actorId":"$supervisor_id","reason":"Cross-incident lineage guard fixture","authorizedAt":"$authorization_state_at","sourceSnapshot":{"inputVersion":1,"snapshotDigest":"1111111111111111111111111111111111111111111111111111111111111111","policyVersion":"ros-eye.input-snapshot.v2","cognitiveRevision":1,"cognitiveDigest":"6666666666666666666666666666666666666666666666666666666666666666"}}}'::jsonb,
  '{"status":"CLOSED","version":14,"closureAuthorization":null}'::jsonb,
  'Forged cross-incident closure must fail', '$forged_closure_trace_id',
  '$forged_closure_event_id', '$authorization_trace_id', '$forged_closure_occurred_at'
);
SQL
then
  echo "Forged cross-incident closure audit unexpectedly committed" >&2
  exit 2
fi

if ! grep -Eq '(^|[^0-9])23514([^0-9]|$)' "$error_log"; then
  echo "Forged cross-incident closure did not return SQLSTATE 23514" >&2
  exit 2
fi

readonly audit_write_set="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*)::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$forged_closure_trace_id') FROM audit_logs WHERE trace_id='$authorization_trace_id'"
)"
if [[ "$audit_write_set" != '1|0' ]]; then
  echo "Forged cross-incident closure changed the audit write set: $audit_write_set" >&2
  exit 2
fi

run_closure_racer() {
  local trace_id="$1"
  local reason="$2"
  local occurred_at="$3"
  local racer_error_log="$4"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At > /dev/null 2>"$racer_error_log" <<SQL
\set VERBOSITY verbose
BEGIN;
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id, correlation_id, causation_id,
  occurred_at
) VALUES (
  'SUPERVISOR', '$supervisor_id',
  'road_event.closed', 'RoadEvent', '$authorization_event_id',
  '{"status":"RECOVERY","version":13,"closureAuthorization":{"actorId":"$supervisor_id","reason":"Cross-incident lineage guard fixture","authorizedAt":"$authorization_state_at","sourceSnapshot":{"inputVersion":1,"snapshotDigest":"1111111111111111111111111111111111111111111111111111111111111111","policyVersion":"ros-eye.input-snapshot.v2","cognitiveRevision":1,"cognitiveDigest":"6666666666666666666666666666666666666666666666666666666666666666"}}}'::jsonb,
  '{"status":"CLOSED","version":14,"closureAuthorization":null}'::jsonb,
  '$reason', '$trace_id',
  '$authorization_event_id', '$authorization_trace_id', '$occurred_at'
);
SELECT pg_sleep(0.25);
COMMIT;
SQL
}

set +e
run_closure_racer \
  "$valid_closure_trace_id" \
  'Concurrent authorization consumer A' \
  "$first_racer_occurred_at" \
  "$first_racer_error_log" &
first_racer_pid=$!
run_closure_racer \
  "$duplicate_closure_trace_id" \
  'Concurrent authorization consumer B' \
  "$second_racer_occurred_at" \
  "$second_racer_error_log" &
second_racer_pid=$!
wait "$first_racer_pid"
first_racer_status=$?
wait "$second_racer_pid"
second_racer_status=$?
set -e

if ! { [[ "$first_racer_status" -eq 0 && "$second_racer_status" -ne 0 ]] \
  || [[ "$first_racer_status" -ne 0 && "$second_racer_status" -eq 0 ]]; }; then
  echo "Concurrent authorization consumers did not produce exactly one winner: $first_racer_status|$second_racer_status" >&2
  exit 2
fi

if [[ "$first_racer_status" -ne 0 ]]; then
  readonly loser_error_log="$first_racer_error_log"
  readonly winner_trace_id="$duplicate_closure_trace_id"
  readonly loser_trace_id="$valid_closure_trace_id"
else
  readonly loser_error_log="$second_racer_error_log"
  readonly winner_trace_id="$valid_closure_trace_id"
  readonly loser_trace_id="$duplicate_closure_trace_id"
fi
if ! grep -Eq '(^|[^0-9])23505([^0-9]|$)' "$loser_error_log"; then
  echo "Concurrent authorization race loser did not return SQLSTATE 23505" >&2
  exit 2
fi

readonly audit_lineage_state="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*) FILTER (WHERE action='road_event.closure_authorized')::text || '|' || count(*) FILTER (WHERE action='road_event.closed')::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$forged_closure_trace_id') || '|' || count(*) FILTER (WHERE action='road_event.closed' AND causation_id='$authorization_trace_id')::text FROM audit_logs WHERE resource_type='RoadEvent' AND resource_id='$authorization_event_id'"
)"
if [[ "$audit_lineage_state" != '1|1|0|1' ]]; then
  echo "Exact same-incident closure did not produce one durable causal pair: $audit_lineage_state" >&2
  exit 2
fi
readonly race_trace_state="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT (SELECT count(*)::text FROM audit_logs WHERE trace_id='$winner_trace_id') || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$loser_trace_id')"
)"
if [[ "$race_trace_state" != '1|0' ]]; then
  echo "Concurrent authorization race trace identities were not durable and exclusive: $race_trace_state" >&2
  exit 2
fi

printf '%s\n' \
  'CROSS_INCIDENT_CAUSATION' \
  'REJECTED' \
  'SQLSTATE' \
  '23514' \
  'AUDIT_WRITE_SET' \
  'AUTHORIZATION_ONLY' \
  'SAME_INCIDENT_CAUSATION' \
  'ACCEPTED' \
  'AUDIT_WRITE_SET' \
  'AUTHORIZATION_AND_CLOSURE' \
  'AUDIT_LINEAGE_STATE' \
  "$audit_lineage_state" \
  'DUPLICATE_CAUSATION' \
  'REJECTED' \
  'SQLSTATE' \
  '23505' \
  'CONCURRENT_CAUSATION_RACE' \
  'ONE_ACCEPTED_ONE_REJECTED' \
  'LOSER_SQLSTATE' \
  '23505' \
  'WINNER_TRACE' \
  "$winner_trace_id" \
  'LOSER_TRACE' \
  "$loser_trace_id" \
  'RACE_TRACE_STATE' \
  "$race_trace_state" \
  'FIXTURE' \
  "$fixture" \
  > "$ROS_POSTGRES_AUDIT_LINEAGE_PROOF_FILE"
