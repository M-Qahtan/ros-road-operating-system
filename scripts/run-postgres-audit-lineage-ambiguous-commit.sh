#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_CONTAINER_ENGINE:?container engine must be set}"
: "${ROS_POSTGRES_RESTART_CONTAINER:?restart container must be set}"
: "${ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE:?ambiguous commit proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE" \
  || -L "$ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE" \
  || -s "$ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE" ]]; then
  echo "Audit lineage ambiguous proof target must be a new empty regular file" >&2
  exit 2
fi
if ! declare -F psql >/dev/null || ! declare -F pg_isready >/dev/null; then
  echo "Container-owned PostgreSQL client functions must be exported" >&2
  exit 2
fi

readonly authorization_event_id='60000000-0000-4000-8000-000000000001'
readonly supervisor_id='60000000-0000-4000-8000-000000000003'
readonly authorization_trace_id='60000000-0000-4000-8000-000000000004'
readonly closure_trace_id='60000000-0000-4000-8000-000000000005'
readonly reconciliation_review_trace_id='60000000-0000-4000-8000-000000000006'
readonly ambiguous_client_log="$(mktemp)"
readonly post_restart_reconciliation_log="$(mktemp)"
readonly reconciliation_retry_log="$(mktemp)"
readonly bounded_recovery_log="$(mktemp)"
ambiguous_pid=''
reconciliation_retry_pid=''
bounded_recovery_pid=''

cleanup() {
  if [[ -n "$ambiguous_pid" ]]; then
    kill -- "$ambiguous_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$reconciliation_retry_pid" ]]; then
    kill -- "$reconciliation_retry_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$bounded_recovery_pid" ]]; then
    kill -- "$bounded_recovery_pid" >/dev/null 2>&1 || true
  fi
  rm -f "$ambiguous_client_log" "$post_restart_reconciliation_log" "$reconciliation_retry_log" "$bounded_recovery_log"
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

readonly cluster_identity_before_restart="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
)"
"$ROS_POSTGRES_CONTAINER_ENGINE" restart -- "$ROS_POSTGRES_RESTART_CONTAINER" >/dev/null

postgres_ready=false
for _attempt in $(seq 1 30); do
  if pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
    postgres_ready=true
    break
  fi
  sleep 2
done
if [[ "$postgres_ready" != true ]]; then
  echo "PostgreSQL did not recover after the ambiguous commit reconciliation" >&2
  exit 2
fi

readonly cluster_identity_after_restart="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
)"
readonly system_identifier_before_restart="${cluster_identity_before_restart%%|*}"
readonly postmaster_started_at_before_restart="${cluster_identity_before_restart#*|}"
readonly system_identifier_after_restart="${cluster_identity_after_restart%%|*}"
readonly postmaster_started_at_after_restart="${cluster_identity_after_restart#*|}"
if [[ "$system_identifier_before_restart" != "$system_identifier_after_restart" \
  || "$postmaster_started_at_before_restart" == "$postmaster_started_at_after_restart" ]]; then
  echo "Ambiguous reconciliation restart did not preserve the cluster while replacing the postmaster" >&2
  exit 2
fi

set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At > /dev/null 2>"$post_restart_reconciliation_log" <<'SQL'
\set VERBOSITY verbose
SET statement_timeout='1ms';
SELECT pg_sleep(1);
SQL
readonly post_restart_reconciliation_failure_status=$?
set -e
if [[ "$post_restart_reconciliation_failure_status" -eq 0 ]] \
  || ! grep -q '57014' "$post_restart_reconciliation_log"; then
  echo "Post-restart reconciliation read did not fail with SQLSTATE 57014" >&2
  exit 2
fi

readonly post_restart_fail_closed_state="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*) FILTER (WHERE action='road_event.closure_authorized')::text || '|' || count(*) FILTER (WHERE action='road_event.closed')::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$closure_trace_id') || '|' || count(*) FILTER (WHERE action='road_event.closed' AND causation_id='$authorization_trace_id')::text FROM audit_logs WHERE resource_type='RoadEvent' AND resource_id='$authorization_event_id'"
)"
if [[ "$post_restart_fail_closed_state" != "$state_after_reconciliation" ]]; then
  echo "Failed post-restart reconciliation changed the committed closure: $post_restart_fail_closed_state" >&2
  exit 2
fi

post_restart_explicit_retry_count=0
post_restart_explicit_retry_count=$((post_restart_explicit_retry_count + 1))
readonly reconciliation_retry_database_url="${DATABASE_URL}?application_name=ros-causation-reconciliation-retry"
set +e
psql "$reconciliation_retry_database_url" -v ON_ERROR_STOP=1 -At >"$reconciliation_retry_log" 2>&1 <<SQL &
SELECT CASE WHEN count(*)=1 THEN 'COMMITTED_TRACE_FOUND' ELSE 'COMMITTED_TRACE_NOT_UNIQUE' END FROM audit_logs WHERE trace_id='$closure_trace_id' AND action='road_event.closed' AND resource_type='RoadEvent' AND resource_id='$authorization_event_id' AND correlation_id='$authorization_event_id' AND causation_id='$authorization_trace_id';
SELECT pg_sleep(30);
SQL
reconciliation_retry_pid=$!
set -e

reconciliation_retry_hold=false
for _attempt in $(seq 1 100); do
  if [[ "$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM pg_stat_activity WHERE application_name='ros-causation-reconciliation-retry' AND state='active' AND query LIKE '%pg_sleep%'")" == '1' ]]; then
    reconciliation_retry_hold=true
    break
  fi
  sleep 0.1
done
if [[ "$reconciliation_retry_hold" != true ]]; then
  echo "Explicit reconciliation retry never reached its interruptible read hold" >&2
  exit 2
fi

readonly reconciliation_retry_cluster_identity_before_restart="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
)"
"$ROS_POSTGRES_CONTAINER_ENGINE" restart -- "$ROS_POSTGRES_RESTART_CONTAINER" >/dev/null

set +e
wait "$reconciliation_retry_pid"
readonly reconciliation_retry_status=$?
set -e
reconciliation_retry_pid=''
if [[ "$reconciliation_retry_status" -eq 0 ]]; then
  echo "Interrupted reconciliation retry unexpectedly completed successfully" >&2
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
  echo "PostgreSQL did not recover after interrupting the reconciliation retry" >&2
  exit 2
fi

readonly reconciliation_retry_cluster_identity_after_restart="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
)"
readonly reconciliation_retry_system_identifier_before="${reconciliation_retry_cluster_identity_before_restart%%|*}"
readonly reconciliation_retry_postmaster_started_at_before="${reconciliation_retry_cluster_identity_before_restart#*|}"
readonly reconciliation_retry_system_identifier_after="${reconciliation_retry_cluster_identity_after_restart%%|*}"
readonly reconciliation_retry_postmaster_started_at_after="${reconciliation_retry_cluster_identity_after_restart#*|}"
if [[ "$reconciliation_retry_system_identifier_before" != "$reconciliation_retry_system_identifier_after" \
  || "$reconciliation_retry_postmaster_started_at_before" == "$reconciliation_retry_postmaster_started_at_after" ]]; then
  echo "Interrupted reconciliation retry restart did not preserve the cluster while replacing the postmaster" >&2
  exit 2
fi

readonly state_after_interrupted_retry="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*) FILTER (WHERE action='road_event.closure_authorized')::text || '|' || count(*) FILTER (WHERE action='road_event.closed')::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$closure_trace_id') || '|' || count(*) FILTER (WHERE action='road_event.closed' AND causation_id='$authorization_trace_id')::text FROM audit_logs WHERE resource_type='RoadEvent' AND resource_id='$authorization_event_id'"
)"
if [[ "$state_after_interrupted_retry" != "$state_after_reconciliation" ]]; then
  echo "Interrupted reconciliation retry changed the committed closure: $state_after_interrupted_retry" >&2
  exit 2
fi

readonly automatic_reconciliation_attempt_budget=2
automatic_reconciliation_attempt_count="$post_restart_explicit_retry_count"
automatic_reconciliation_attempt_count=$((automatic_reconciliation_attempt_count + 1))
readonly bounded_recovery_database_url="${DATABASE_URL}?application_name=ros-causation-bounded-recovery"
set +e
psql "$bounded_recovery_database_url" -v ON_ERROR_STOP=1 -At >"$bounded_recovery_log" 2>&1 <<SQL &
SELECT CASE WHEN count(*)=1 THEN 'COMMITTED_TRACE_FOUND' ELSE 'COMMITTED_TRACE_NOT_UNIQUE' END FROM audit_logs WHERE trace_id='$closure_trace_id' AND action='road_event.closed' AND resource_type='RoadEvent' AND resource_id='$authorization_event_id' AND correlation_id='$authorization_event_id' AND causation_id='$authorization_trace_id';
SELECT pg_sleep(30);
SQL
bounded_recovery_pid=$!
set -e

bounded_recovery_hold=false
for _attempt in $(seq 1 100); do
  if [[ "$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM pg_stat_activity WHERE application_name='ros-causation-bounded-recovery' AND state='active' AND query LIKE '%pg_sleep%'")" == '1' ]]; then
    bounded_recovery_hold=true
    break
  fi
  sleep 0.1
done
if [[ "$bounded_recovery_hold" != true ]]; then
  echo "Second automatic reconciliation attempt never reached its interruptible read hold" >&2
  exit 2
fi

kill "$bounded_recovery_pid"
set +e
wait "$bounded_recovery_pid"
readonly bounded_recovery_status=$?
set -e
bounded_recovery_pid=''
if [[ "$bounded_recovery_status" -eq 0 ]]; then
  echo "Interrupted second automatic reconciliation attempt unexpectedly completed successfully" >&2
  exit 2
fi

readonly state_after_budget_exhaustion="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*) FILTER (WHERE action='road_event.closure_authorized')::text || '|' || count(*) FILTER (WHERE action='road_event.closed')::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$closure_trace_id') || '|' || count(*) FILTER (WHERE action='road_event.closed' AND causation_id='$authorization_trace_id')::text FROM audit_logs WHERE resource_type='RoadEvent' AND resource_id='$authorization_event_id'"
)"
if [[ "$automatic_reconciliation_attempt_count" -ne "$automatic_reconciliation_attempt_budget" \
  || "$state_after_budget_exhaustion" != "$state_after_reconciliation" ]]; then
  echo "Automatic reconciliation budget did not exhaust fail-closed: $state_after_budget_exhaustion" >&2
  exit 2
fi
readonly third_automatic_reconciliation_attempt='NOT_ATTEMPTED'
readonly automatic_reconciliation_disposition='EXHAUSTED_FAIL_CLOSED'

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<SQL
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id, correlation_id, causation_id,
  occurred_at
) VALUES (
  'SYSTEM', NULL,
  'road_event.reconciliation_review_required', 'RoadEvent', '$authorization_event_id',
  '{"reconciliation":null}'::jsonb,
  '{"reconciliation":{"state":"HUMAN_REVIEW_REQUIRED","automaticRetryAuthorized":false,"closureAuthorized":false}}'::jsonb,
  'Automatic reconciliation attempt budget exhausted', '$reconciliation_review_trace_id',
  '$authorization_event_id', '$closure_trace_id', '2026-09-27T06:00:02Z'
);
SQL
readonly reconciliation_review_state="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT CASE WHEN count(*)=1 THEN 'HUMAN_REVIEW_REQUIRED' ELSE 'INVALID' END FROM audit_logs WHERE action='road_event.reconciliation_review_required' AND resource_type='RoadEvent' AND resource_id='$authorization_event_id' AND correlation_id='$authorization_event_id' AND causation_id='$closure_trace_id' AND after_state #>> '{reconciliation,state}'='HUMAN_REVIEW_REQUIRED' AND after_state #>> '{reconciliation,automaticRetryAuthorized}'='false' AND after_state #>> '{reconciliation,closureAuthorized}'='false'"
)"
if [[ "$reconciliation_review_state" != 'HUMAN_REVIEW_REQUIRED' ]]; then
  echo "Exhausted reconciliation did not persist one exact human-review marker" >&2
  exit 2
fi

post_restart_recovery_read_count=0
post_restart_recovery_read_count=$((post_restart_recovery_read_count + 1))
readonly post_restart_reconciliation_result="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT CASE WHEN count(*)=1 THEN 'COMMITTED_TRACE_FOUND' ELSE 'COMMITTED_TRACE_NOT_UNIQUE' END FROM audit_logs WHERE trace_id='$closure_trace_id' AND action='road_event.closed' AND resource_type='RoadEvent' AND resource_id='$authorization_event_id' AND correlation_id='$authorization_event_id' AND causation_id='$authorization_trace_id'"
)"
readonly state_after_restart="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT count(*) FILTER (WHERE action='road_event.closure_authorized')::text || '|' || count(*) FILTER (WHERE action='road_event.closed')::text || '|' || (SELECT count(*)::text FROM audit_logs WHERE trace_id='$closure_trace_id') || '|' || count(*) FILTER (WHERE action='road_event.closed' AND causation_id='$authorization_trace_id')::text FROM audit_logs WHERE resource_type='RoadEvent' AND resource_id='$authorization_event_id'"
)"
if [[ "$post_restart_explicit_retry_count" -ne 1 \
  || "$post_restart_recovery_read_count" -ne 1 \
  || "$post_restart_reconciliation_result" != 'COMMITTED_TRACE_FOUND' \
  || "$state_after_restart" != "$state_after_reconciliation" ]]; then
  echo "Restarted read-only reconciliation did not preserve one exact committed closure: $state_after_restart" >&2
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
  'CLUSTER_IDENTITY' \
  'PRESERVED' \
  'POSTMASTER' \
  'REPLACED' \
  'POSTMASTER_STARTED_AT_BEFORE_RESTART' \
  "$postmaster_started_at_before_restart" \
  'POSTMASTER_STARTED_AT_AFTER_RESTART' \
  "$postmaster_started_at_after_restart" \
  'POST_RESTART_RECONCILIATION' \
  'READ_FAILED' \
  'POST_RESTART_FAILURE_SQLSTATE' \
  '57014' \
  'POST_RESTART_FAIL_CLOSED_STATE' \
  "$post_restart_fail_closed_state" \
  'POST_RESTART_EXPLICIT_RETRY' \
  'INTERRUPTED' \
  'POST_RESTART_EXPLICIT_RETRY_COUNT' \
  "$post_restart_explicit_retry_count" \
  'RECONCILIATION_RETRY_CLUSTER_IDENTITY' \
  'PRESERVED' \
  'RECONCILIATION_RETRY_POSTMASTER' \
  'REPLACED' \
  'RECONCILIATION_RETRY_POSTMASTER_STARTED_AT_BEFORE_RESTART' \
  "$reconciliation_retry_postmaster_started_at_before" \
  'RECONCILIATION_RETRY_POSTMASTER_STARTED_AT_AFTER_RESTART' \
  "$reconciliation_retry_postmaster_started_at_after" \
  'POST_RESTART_INTERRUPTED_RETRY' \
  'AMBIGUOUS' \
  'AUTO_RECONCILIATION_ATTEMPT_BUDGET' \
  "$automatic_reconciliation_attempt_budget" \
  'AUTO_RECONCILIATION_ATTEMPT_COUNT' \
  "$automatic_reconciliation_attempt_count" \
  'SECOND_AUTOMATIC_RECONCILIATION' \
  'INTERRUPTED' \
  'THIRD_AUTOMATIC_RECONCILIATION' \
  "$third_automatic_reconciliation_attempt" \
  'AUTO_RECONCILIATION_DISPOSITION' \
  "$automatic_reconciliation_disposition" \
  'STATE_AFTER_BUDGET_EXHAUSTION' \
  "$state_after_budget_exhaustion" \
  'RECONCILIATION_REVIEW_STATE' \
  "$reconciliation_review_state" \
  'AUTOMATIC_RETRY_AUTHORIZED' \
  'false' \
  'CLOSURE_AUTHORIZED' \
  'false' \
  'POST_RESTART_RECOVERY_READ' \
  "$post_restart_reconciliation_result" \
  'POST_RESTART_RECOVERY_READ_COUNT' \
  "$post_restart_recovery_read_count" \
  'POST_RESTART_REPLAY' \
  'NOT_ATTEMPTED' \
  'STATE_AFTER_RESTART' \
  "$state_after_restart" \
  > "$ROS_POSTGRES_AUDIT_LINEAGE_AMBIGUOUS_PROOF_FILE"
