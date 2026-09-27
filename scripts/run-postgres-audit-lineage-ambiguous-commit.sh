#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE:?ambiguous commit proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE" \
  || -L "$ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE" \
  || -s "$ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE" ]]; then
  echo "Audit lineage ambiguous proof target must be a new empty regular file" >&2
  exit 2
fi
if ! declare -F psql >/dev/null; then
  echo "Container-owned PostgreSQL client function must be exported" >&2
  exit 2
fi

readonly authorization_event_id='60000000-0000-4000-8000-000000000001'
readonly supervisor_id='60000000-0000-4000-8000-000000000003'
readonly authorization_trace_id='60000000-0000-4000-8000-000000000004'
readonly closure_trace_id='60000000-0000-4000-8000-000000000005'
readonly ambiguous_client_log="$(mktemp)"
ambiguous_pid=''

cleanup() {
  if [[ -n "$ambiguous_pid" ]]; then
    kill -- "$ambiguous_pid" >/dev/null 2>&1 || true
  fi
  rm -f "$ambiguous_client_log"
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
  '{"status":"RECOVERY","version":13,"closureAuthorization":{"actorId":"$supervisor_id","reason":"Ambiguous commit fixture","authorizedAt":"2026-09-27T06:00:00.000Z","sourceSnapshot":{"inputVersion":1,"snapshotDigest":"1111111111111111111111111111111111111111111111111111111111111111","policyVersion":"ros-eye.input-snapshot.v2","cognitiveRevision":1,"cognitiveDigest":"6666666666666666666666666666666666666666666666666666666666666666"}}}'::jsonb,
  'Ambiguous commit fixture', '$authorization_trace_id',
  '$authorization_event_id', NULL, '2026-09-27T06:00:00Z'
);
SQL

readonly ambiguous_database_url="${DATABASE_URL}?application_name=ros-causation-ambiguous-client"
set +e
psql "$ambiguous_database_url" -v ON_ERROR_STOP=1 -At > /dev/null 2>"$ambiguous_client_log" <<SQL &
BEGIN;
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id, correlation_id, causation_id,
  occurred_at
) VALUES (
  'SUPERVISOR', '$supervisor_id',
  'road_event.closed', 'RoadEvent', '$authorization_event_id',
  '{"status":"RECOVERY","version":13,"closureAuthorization":{"actorId":"$supervisor_id","reason":"Ambiguous commit fixture","authorizedAt":"2026-09-27T06:00:00.000Z","sourceSnapshot":{"inputVersion":1,"snapshotDigest":"1111111111111111111111111111111111111111111111111111111111111111","policyVersion":"ros-eye.input-snapshot.v2","cognitiveRevision":1,"cognitiveDigest":"6666666666666666666666666666666666666666666666666666666666666666"}}}'::jsonb,
  '{"status":"CLOSED","version":14,"closureAuthorization":null}'::jsonb,
  'Commit whose client acknowledgement is lost', '$closure_trace_id',
  '$authorization_event_id', '$authorization_trace_id', '2026-09-27T06:00:01Z'
);
COMMIT;
SELECT pg_sleep(30);
SQL
ambiguous_pid=$!
set -e

post_commit_hold=false
for _attempt in $(seq 1 100); do
  if [[ "$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM pg_stat_activity WHERE application_name='ros-causation-ambiguous-client' AND state='active' AND query LIKE '%pg_sleep%'")" == '1' ]]; then
    post_commit_hold=true
    break
  fi
  sleep 0.1
done
if [[ "$post_commit_hold" != true ]]; then
  echo "Ambiguous client never reached the post-commit acknowledgement hold point" >&2
  exit 2
fi

kill "$ambiguous_pid"
set +e
wait "$ambiguous_pid"
readonly ambiguous_status=$?
set -e
ambiguous_pid=''
if [[ "$ambiguous_status" -eq 0 ]]; then
  echo "Ambiguous client unexpectedly received a successful completion" >&2
  exit 2
fi

readonly state_before_reconciliation="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*) FILTER (WHERE action='road_event.closure_authorized')::text || '|' || count(*) FILTER (WHERE action='road_event.closed')::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$closure_trace_id') || '|' || count(*) FILTER (WHERE action='road_event.closed' AND causation_id='$authorization_trace_id')::text FROM audit_logs WHERE resource_type='RoadEvent' AND resource_id='$authorization_event_id'"
)"
if [[ "$state_before_reconciliation" != '1|1|1|1' ]]; then
  echo "Post-commit transport loss did not leave one exact durable causal pair: $state_before_reconciliation" >&2
  exit 2
fi

readonly reconciliation_result="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT CASE WHEN count(*)=1 THEN 'COMMITTED_TRACE_FOUND' ELSE 'COMMITTED_TRACE_NOT_UNIQUE' END FROM audit_logs WHERE trace_id='$closure_trace_id' AND action='road_event.closed' AND resource_type='RoadEvent' AND resource_id='$authorization_event_id' AND correlation_id='$authorization_event_id' AND causation_id='$authorization_trace_id'"
)"
if [[ "$reconciliation_result" != 'COMMITTED_TRACE_FOUND' ]]; then
  echo "Read-only trace reconciliation did not find the exact committed closure" >&2
  exit 2
fi

readonly state_after_reconciliation="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*) FILTER (WHERE action='road_event.closure_authorized')::text || '|' || count(*) FILTER (WHERE action='road_event.closed')::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$closure_trace_id') || '|' || count(*) FILTER (WHERE action='road_event.closed' AND causation_id='$authorization_trace_id')::text FROM audit_logs WHERE resource_type='RoadEvent' AND resource_id='$authorization_event_id'"
)"
if [[ "$state_after_reconciliation" != "$state_before_reconciliation" ]]; then
  echo "Read-only reconciliation replayed or mutated the closure command: $state_after_reconciliation" >&2
  exit 2
fi

printf '%s\n' \
  'POST_COMMIT_RESULT' \
  'AMBIGUOUS' \
  'CLIENT_ACK' \
  'LOST' \
  'STATE_BEFORE_RECONCILIATION' \
  "$state_before_reconciliation" \
  'RECONCILIATION' \
  "$reconciliation_result" \
  'REPLAY' \
  'NOT_ATTEMPTED' \
  'STATE_AFTER_RECONCILIATION' \
  "$state_after_reconciliation" \
  > "$ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE"
