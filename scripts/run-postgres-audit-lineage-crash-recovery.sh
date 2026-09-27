#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_CONTAINER_ENGINE:?container engine must be set}"
: "${ROS_POSTGRES_RESTART_CONTAINER:?restart container must be set}"
: "${ROS_POSTGRES_AUDIT_LINEAGE_CRASH_PROOF_FILE:?crash recovery proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_AUDIT_LINEAGE_CRASH_PROOF_FILE" \
  || -L "$ROS_POSTGRES_AUDIT_LINEAGE_CRASH_PROOF_FILE" \
  || -s "$ROS_POSTGRES_AUDIT_LINEAGE_CRASH_PROOF_FILE" ]]; then
  echo "Audit lineage crash proof target must be a new empty regular file" >&2
  exit 2
fi
if ! declare -F psql >/dev/null || ! declare -F pg_isready >/dev/null; then
  echo "Container-owned PostgreSQL client functions must be exported" >&2
  exit 2
fi

readonly authorization_event_id='50000000-0000-4000-8000-000000000001'
readonly supervisor_id='50000000-0000-4000-8000-000000000003'
readonly authorization_trace_id='50000000-0000-4000-8000-000000000004'
readonly interrupted_closure_trace_id='50000000-0000-4000-8000-000000000005'
readonly retry_closure_trace_id='50000000-0000-4000-8000-000000000006'
readonly duplicate_closure_trace_id='50000000-0000-4000-8000-000000000007'
readonly interrupted_error_log="$(mktemp)"
readonly duplicate_error_log="$(mktemp)"

cleanup() {
  rm -f "$interrupted_error_log" "$duplicate_error_log"
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
  '{"status":"RECOVERY","version":13,"closureAuthorization":{"actorId":"$supervisor_id","reason":"Crash recovery guard fixture","authorizedAt":"2026-09-27T02:00:00.000Z","sourceSnapshot":{"inputVersion":1,"snapshotDigest":"1111111111111111111111111111111111111111111111111111111111111111","policyVersion":"ros-eye.input-snapshot.v2","cognitiveRevision":1,"cognitiveDigest":"6666666666666666666666666666666666666666666666666666666666666666"}}}'::jsonb,
  'Crash recovery guard fixture', '$authorization_trace_id',
  '$authorization_event_id', NULL, '2026-09-27T02:00:00Z'
);
SQL

readonly cluster_identity_before="$({
  psql "$DATABASE_URL" -Atqc \
    "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
})"
readonly holder_database_url="${DATABASE_URL}?application_name=ros-causation-crash-holder"

set +e
psql "$holder_database_url" -v ON_ERROR_STOP=1 -At > /dev/null 2>"$interrupted_error_log" <<SQL &
BEGIN;
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id, correlation_id, causation_id,
  occurred_at
) VALUES (
  'SUPERVISOR', '$supervisor_id',
  'road_event.closed', 'RoadEvent', '$authorization_event_id',
  '{"status":"RECOVERY","version":13,"closureAuthorization":{"actorId":"$supervisor_id","reason":"Crash recovery guard fixture","authorizedAt":"2026-09-27T02:00:00.000Z","sourceSnapshot":{"inputVersion":1,"snapshotDigest":"1111111111111111111111111111111111111111111111111111111111111111","policyVersion":"ros-eye.input-snapshot.v2","cognitiveRevision":1,"cognitiveDigest":"6666666666666666666666666666666666666666666666666666666666666666"}}}'::jsonb,
  '{"status":"CLOSED","version":14,"closureAuthorization":null}'::jsonb,
  'Interrupted closure must roll back', '$interrupted_closure_trace_id',
  '$authorization_event_id', '$authorization_trace_id', '2026-09-27T02:00:01Z'
);
SELECT pg_sleep(30);
COMMIT;
SQL
interrupted_pid=$!
set -e

holder_ready=false
for _attempt in $(seq 1 100); do
  if [[ "$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM pg_stat_activity WHERE application_name='ros-causation-crash-holder' AND state='active' AND query LIKE '%pg_sleep%'")" == '1' ]]; then
    holder_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$holder_ready" != true ]]; then
  echo "Interrupted closure never reached the pre-commit hold point" >&2
  exit 2
fi

"$ROS_POSTGRES_CONTAINER_ENGINE" restart -- "$ROS_POSTGRES_RESTART_CONTAINER" >/dev/null
set +e
wait "$interrupted_pid"
readonly interrupted_status=$?
set -e
if [[ "$interrupted_status" -eq 0 ]]; then
  echo "Interrupted closure unexpectedly committed before restart" >&2
  exit 2
fi

postgres_ready=false
for _attempt in $(seq 1 30); do
  if pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
    postgres_ready=true
    break
  fi
  sleep 2
done
if [[ "$postgres_ready" != true ]]; then
  echo "PostgreSQL did not recover after interrupting the closure transaction" >&2
  exit 2
fi

readonly cluster_identity_after="$({
  psql "$DATABASE_URL" -Atqc \
    "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
})"
readonly system_identifier_before="${cluster_identity_before%%|*}"
readonly postmaster_started_at_before="${cluster_identity_before#*|}"
readonly system_identifier_after="${cluster_identity_after%%|*}"
readonly postmaster_started_at_after="${cluster_identity_after#*|}"
if [[ "$system_identifier_before" != "$system_identifier_after" \
  || "$postmaster_started_at_before" == "$postmaster_started_at_after" ]]; then
  echo "Crash recovery did not preserve the cluster while replacing the postmaster" >&2
  exit 2
fi

readonly rollback_state="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*) FILTER (WHERE action='road_event.closure_authorized')::text || '|' || count(*) FILTER (WHERE action='road_event.closed')::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$interrupted_closure_trace_id') || '|' || count(*) FILTER (WHERE action='road_event.closed' AND causation_id='$authorization_trace_id')::text FROM audit_logs WHERE resource_type='RoadEvent' AND resource_id='$authorization_event_id'"
)"
if [[ "$rollback_state" != '1|0|0|0' ]]; then
  echo "Interrupted closure transaction did not roll back exactly: $rollback_state" >&2
  exit 2
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<SQL
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id, correlation_id, causation_id,
  occurred_at
) VALUES (
  'SUPERVISOR', '$supervisor_id',
  'road_event.closed', 'RoadEvent', '$authorization_event_id',
  '{"status":"RECOVERY","version":13,"closureAuthorization":{"actorId":"$supervisor_id","reason":"Crash recovery guard fixture","authorizedAt":"2026-09-27T02:00:00.000Z","sourceSnapshot":{"inputVersion":1,"snapshotDigest":"1111111111111111111111111111111111111111111111111111111111111111","policyVersion":"ros-eye.input-snapshot.v2","cognitiveRevision":1,"cognitiveDigest":"6666666666666666666666666666666666666666666666666666666666666666"}}}'::jsonb,
  '{"status":"CLOSED","version":14,"closureAuthorization":null}'::jsonb,
  'Controlled retry after crash recovery', '$retry_closure_trace_id',
  '$authorization_event_id', '$authorization_trace_id', '2026-09-27T02:00:02Z'
);
SQL

if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At > /dev/null 2>"$duplicate_error_log" <<SQL
\set VERBOSITY verbose
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id, correlation_id, causation_id,
  occurred_at
) VALUES (
  'SUPERVISOR', '$supervisor_id',
  'road_event.closed', 'RoadEvent', '$authorization_event_id',
  '{"status":"RECOVERY","version":13,"closureAuthorization":{"actorId":"$supervisor_id","reason":"Crash recovery guard fixture","authorizedAt":"2026-09-27T02:00:00.000Z","sourceSnapshot":{"inputVersion":1,"snapshotDigest":"1111111111111111111111111111111111111111111111111111111111111111","policyVersion":"ros-eye.input-snapshot.v2","cognitiveRevision":1,"cognitiveDigest":"6666666666666666666666666666666666666666666666666666666666666666"}}}'::jsonb,
  '{"status":"CLOSED","version":14,"closureAuthorization":null}'::jsonb,
  'Duplicate controlled retry must fail', '$duplicate_closure_trace_id',
  '$authorization_event_id', '$authorization_trace_id', '2026-09-27T02:00:03Z'
);
SQL
then
  echo "Duplicate controlled closure retry unexpectedly committed" >&2
  exit 2
fi
if ! grep -Eq '(^|[^0-9])23505([^0-9]|$)' "$duplicate_error_log"; then
  echo "Duplicate controlled closure retry did not return SQLSTATE 23505" >&2
  exit 2
fi

readonly final_state="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*) FILTER (WHERE action='road_event.closure_authorized')::text || '|' || count(*) FILTER (WHERE action='road_event.closed')::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$interrupted_closure_trace_id') || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$retry_closure_trace_id') || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$duplicate_closure_trace_id') || '|' || count(*) FILTER (WHERE action='road_event.closed' AND causation_id='$authorization_trace_id')::text FROM audit_logs WHERE resource_type='RoadEvent' AND resource_id='$authorization_event_id'"
)"
if [[ "$final_state" != '1|1|0|1|0|1' ]]; then
  echo "Crash recovery retry did not produce one exact durable causal pair: $final_state" >&2
  exit 2
fi

printf '%s\n' \
  'CRASH_BEFORE_COMMIT' \
  'CONNECTION_TERMINATED' \
  'CLUSTER_IDENTITY' \
  'PRESERVED' \
  'POSTMASTER' \
  'REPLACED' \
  'ROLLBACK_STATE' \
  "$rollback_state" \
  'CONTROLLED_RETRY' \
  'COMMITTED' \
  'DUPLICATE_RETRY' \
  'REJECTED' \
  'SQLSTATE' \
  '23505' \
  'FINAL_STATE' \
  "$final_state" \
  > "$ROS_POSTGRES_AUDIT_LINEAGE_CRASH_PROOF_FILE"
