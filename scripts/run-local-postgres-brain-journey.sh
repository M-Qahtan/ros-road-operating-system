#!/usr/bin/env bash
set -euo pipefail

container_engine=''
for candidate_engine in docker podman; do
  if command -v "$candidate_engine" >/dev/null 2>&1; then
    container_engine="$candidate_engine"
    break
  fi
done
readonly container_engine

if [[ -z "$container_engine" ]]; then
  echo "Required local integration tool 'docker' or 'podman' is unavailable; no PostgreSQL journey was executed" >&2
  exit 127
fi

for required_command in git mktemp node seq sha256sum sleep; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required local receipt tool '$required_command' is unavailable; no PostgreSQL journey was executed" >&2
    exit 127
  fi
done

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "PostgreSQL journey requires a clean candidate worktree; no integration test was executed" >&2
  exit 2
fi

readonly candidate_sha="$(git rev-parse --verify HEAD)"
readonly journey_manifest_sha256="$(
  sha256sum \
    scripts/run-local-postgres-brain-journey.sh \
    scripts/run-postgres-integration.sh \
    scripts/run-postgres-closure-race.sh \
    scripts/run-postgres-contact-closure-race.sh \
    scripts/run-postgres-cognitive-closure-drift.sh \
    scripts/run-postgres-cognitive-closure-recovery.sh \
    scripts/run-postgres-closure-authorization-read.sh \
    scripts/run-postgres-closure-reauthorization-recovery.sh \
    database/migrations/*.sql \
    database/seeds/*.sql \
    database/tests/*.sql \
    | sha256sum | cut -d ' ' -f 1
)"

readonly container_name="ros-brain-postgres-${$}"
readonly postgres_password="ros-local-integration-only"
readonly restart_proof_file="$(mktemp)"
readonly closure_race_proof_file="$(mktemp)"
readonly contact_closure_race_proof_file="$(mktemp)"
readonly cognitive_closure_proof_file="$(mktemp)"
readonly cognitive_closure_recovery_proof_file="$(mktemp)"
readonly closure_authorization_read_proof_file="$(mktemp)"
readonly closure_reauthorization_proof_file="$(mktemp)"
readonly post_restart_duplicate_log="$(mktemp)"
readonly post_restart_wrong_purpose_log="$(mktemp)"
readonly post_restart_wrong_tenant_log="$(mktemp)"
readonly post_restart_wrong_case_log="$(mktemp)"
readonly post_restart_stale_parent_log="$(mktemp)"
readonly post_restart_closed_parent_log="$(mktemp)"

cleanup() {
  "$container_engine" rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f "$restart_proof_file"
  rm -f "$closure_race_proof_file"
  rm -f "$contact_closure_race_proof_file"
  rm -f "$cognitive_closure_proof_file"
  rm -f "$cognitive_closure_recovery_proof_file"
  rm -f "$closure_authorization_read_proof_file"
  rm -f "$closure_reauthorization_proof_file"
  rm -f "$post_restart_duplicate_log"
  rm -f "$post_restart_wrong_purpose_log"
  rm -f "$post_restart_wrong_tenant_log"
  rm -f "$post_restart_wrong_case_log"
  rm -f "$post_restart_stale_parent_log"
  rm -f "$post_restart_closed_parent_log"
}
trap cleanup EXIT

"$container_engine" run --rm --detach \
  --name "$container_name" \
  --volume "$(pwd):/workspace:ro" \
  --env POSTGRES_DB=ros \
  --env POSTGRES_USER=ros \
  --env "POSTGRES_PASSWORD=${postgres_password}" \
  postgis/postgis:16-3.4 >/dev/null

pg_isready() {
  "$ROS_POSTGRES_CONTAINER_ENGINE" exec "$container_name" pg_isready "$@"
}

psql() {
  "$ROS_POSTGRES_CONTAINER_ENGINE" exec --interactive --workdir /workspace "$container_name" psql "$@"
}

wait_for_postgres() {
  local phase="$1"
  for attempt in $(seq 1 30); do
    if pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
      return 0
    fi
    if [[ "$attempt" == "30" ]]; then
      echo "PostgreSQL did not become ready ${phase}" >&2
      return 1
    fi
    sleep 2
  done
}

export -f pg_isready psql
export container_name
export DATABASE_URL="postgresql://ros:${postgres_password}@127.0.0.1:5432/ros"
export ROS_POSTGRES_CONTAINER_ENGINE="$container_engine"
export ROS_POSTGRES_RESTART_CONTAINER="$container_name"
export ROS_POSTGRES_RESTART_BEFORE_TEST="0011_ros_brain_journey_reconnect.sql"
export ROS_POSTGRES_RESTART_PROOF_FILE="$restart_proof_file"
export ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE="$closure_race_proof_file"
export ROS_POSTGRES_CONTACT_CLOSURE_RACE_PROOF_FILE="$contact_closure_race_proof_file"
export ROS_POSTGRES_COGNITIVE_CLOSURE_PROOF_FILE="$cognitive_closure_proof_file"
bash scripts/run-postgres-integration.sh

mapfile -t restart_proof < "$restart_proof_file"
if [[ "${#restart_proof[@]}" -ne 4 ]]; then
  echo "PostgreSQL journey passed without a complete restart identity proof" >&2
  exit 2
fi
mapfile -t contact_closure_race_proof < "$contact_closure_race_proof_file"
if [[ "${#contact_closure_race_proof[@]}" -ne 14 \
  || "${contact_closure_race_proof[0]}" != "CONTACT_COMMAND" \
  || "${contact_closure_race_proof[1]}" != "COMMITTED" \
  || "${contact_closure_race_proof[2]}" != "CLOSURE" \
  || ! "${contact_closure_race_proof[3]}" =~ ^(SOURCE_SNAPSHOT_CHANGED|SERIALIZATION_FAILURE)$ \
  || "${contact_closure_race_proof[4]}" != "CLOSURE" \
  || "${contact_closure_race_proof[5]}" != "COMMITTED" \
  || "${contact_closure_race_proof[6]}" != "CONTACT_COMMAND" \
  || ! "${contact_closure_race_proof[7]}" =~ ^(INCIDENT_CLOSED|SERIALIZATION_FAILURE)$ \
  || "${contact_closure_race_proof[8]}" != "ATOMIC_ROLLBACK" \
  || "${contact_closure_race_proof[9]}" != "VERIFIED" \
  || "${contact_closure_race_proof[10]}" != "FORWARD_RETRY" \
  || "${contact_closure_race_proof[11]}" != "COMMITTED" \
  || "${contact_closure_race_proof[12]}" != "DUPLICATE_RETRY" \
  || "${contact_closure_race_proof[13]}" != "REJECTED" ]]; then
  echo "PostgreSQL journey passed without exact contact/closure winners, atomic rollback, and forward retry proof" >&2
  exit 2
fi
mapfile -t cognitive_closure_proof < "$cognitive_closure_proof_file"
if [[ "${#cognitive_closure_proof[@]}" -ne 12 \
  || "${cognitive_closure_proof[0]}" != "COGNITIVE_CLOSURE_DRIFT" \
  || "${cognitive_closure_proof[1]}" != "REJECTED" \
  || "${cognitive_closure_proof[2]}" != "ROAD_EVENT_AUDIT_OUTBOX" \
  || "${cognitive_closure_proof[3]}" != "UNCHANGED" \
  || "${cognitive_closure_proof[4]}" != "AUTHORIZATION_HISTORY" \
  || "${cognitive_closure_proof[5]}" != "UNCHANGED" \
  || "${cognitive_closure_proof[6]}" != "COGNITIVE_CLOSURE_STATE" \
  || "${cognitive_closure_proof[7]}" != "RECOVERY|2|1|1|2|2|0|0" \
  || "${cognitive_closure_proof[8]}" != "CLOSURE_AUTHORIZATION_JOURNAL" \
  || "${cognitive_closure_proof[9]}" != "UPDATE_DELETE_REJECTED" \
  || "${cognitive_closure_proof[10]}" != "CLOSURE_AUTHORIZATION_JOURNAL_STATE" \
  || "${cognitive_closure_proof[11]}" != "1|2|1|$(printf '1%.0s' {1..64})|1|$(printf '6%.0s' {1..64})" ]]; then
  echo "Cognitive closure drift proof was incomplete or unsafe: ${cognitive_closure_proof[*]}" >&2
  exit 2
fi
readonly system_identifier_before_restart="${restart_proof[0]}"
readonly postmaster_started_at_before_restart="${restart_proof[1]}"
readonly system_identifier_after_restart="${restart_proof[2]}"
readonly postmaster_started_at_after_restart="${restart_proof[3]}"
mapfile -t closure_race_proof < "$closure_race_proof_file"
if [[ "${#closure_race_proof[@]}" -ne 8 \
  || "${closure_race_proof[0]}" != "SOURCE_UPDATE" \
  || "${closure_race_proof[1]}" != "COMMITTED" \
  || "${closure_race_proof[2]}" != "CLOSURE" \
  || ! "${closure_race_proof[3]}" =~ ^(SOURCE_SNAPSHOT_CHANGED|SERIALIZATION_FAILURE)$ \
  || "${closure_race_proof[4]}" != "CLOSURE" \
  || "${closure_race_proof[5]}" != "COMMITTED" \
  || "${closure_race_proof[6]}" != "SOURCE_UPDATE" \
  || ! "${closure_race_proof[7]}" =~ ^(INCIDENT_CLOSED|SERIALIZATION_FAILURE)$ ]]; then
  echo "PostgreSQL journey passed without one exact safe winner in both closure-race orderings" >&2
  exit 2
fi

readonly contact_recovery_identity_before_restart="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
)"
"$container_engine" restart -- "$container_name" >/dev/null
wait_for_postgres "after contact recovery restart"
readonly contact_recovery_identity_after_restart="$(
  psql "$DATABASE_URL" -Atqc \
    "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
)"
readonly contact_recovery_system_identifier_before_restart="${contact_recovery_identity_before_restart%%|*}"
readonly contact_recovery_postmaster_started_at_before_restart="${contact_recovery_identity_before_restart#*|}"
readonly contact_recovery_system_identifier_after_restart="${contact_recovery_identity_after_restart%%|*}"
readonly contact_recovery_postmaster_started_at_after_restart="${contact_recovery_identity_after_restart#*|}"
readonly cognitive_closure_state_before_restart="${cognitive_closure_proof[7]}"
readonly closure_authorization_journal_state_before_restart="${cognitive_closure_proof[11]}"
readonly cognitive_closure_state_after_restart="$(
  psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || event.closure_source_input_version::text || '|' || event.closure_cognitive_revision::text || '|' || latest.input_version::text || '|' || latest.cognitive_revision::text || '|' || (SELECT count(*)::text FROM audit_logs audit WHERE audit.resource_type='RoadEvent' AND audit.resource_id=event.id) || '|' || (SELECT count(*)::text FROM outbox_events outbox WHERE outbox.aggregate_type='RoadEvent' AND outbox.aggregate_id=event.id) FROM road_events event JOIN LATERAL (SELECT cognitive.input_version, cognitive.cognitive_revision FROM ros_eye_cognitive_input_snapshot_bindings cognitive WHERE cognitive.tenant_id=event.tenant_id AND cognitive.purpose=event.purpose AND cognitive.case_id=event.id ORDER BY cognitive.input_version DESC LIMIT 1) latest ON true WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response' AND event.id='10000000-0000-4000-8000-000000000007'"
)"
readonly closure_authorization_journal_state_after_restart="$(
  psql "$DATABASE_URL" -Atqc "SELECT count(*)::text || '|' || min(event_version)::text || '|' || min(source_input_version)::text || '|' || min(source_snapshot_digest) || '|' || min(cognitive_revision)::text || '|' || min(cognitive_digest) FROM road_event_closure_authorization_journal WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response' AND case_id='10000000-0000-4000-8000-000000000007'"
)"
if [[ "$cognitive_closure_state_before_restart" != 'RECOVERY|2|1|1|2|2|0|0' \
  || "$cognitive_closure_state_after_restart" != "$cognitive_closure_state_before_restart" \
  || "$closure_authorization_journal_state_after_restart" != "$closure_authorization_journal_state_before_restart" ]]; then
  echo "Cognitive closure rejection did not survive PostgreSQL restart exactly: $cognitive_closure_state_after_restart" >&2
  exit 2
fi
export ROS_POSTGRES_COGNITIVE_CLOSURE_RECOVERY_PROOF_FILE="$cognitive_closure_recovery_proof_file"
bash scripts/run-postgres-cognitive-closure-recovery.sh
mapfile -t cognitive_closure_recovery_proof < "$cognitive_closure_recovery_proof_file"
if [[ "${#cognitive_closure_recovery_proof[@]}" -ne 6 \
  || "${cognitive_closure_recovery_proof[0]}" != "COGNITIVE_CLOSURE_RECOVERY" \
  || "${cognitive_closure_recovery_proof[1]}" != "RETRY_REJECTED" \
  || "${cognitive_closure_recovery_proof[2]}" != "ROAD_EVENT_AUDIT_OUTBOX" \
  || "${cognitive_closure_recovery_proof[3]}" != "UNCHANGED" \
  || "${cognitive_closure_recovery_proof[4]}" != "AUTHORIZATION_HISTORY" \
  || "${cognitive_closure_recovery_proof[5]}" != "UNCHANGED" ]]; then
  echo "Post-restart cognitive closure retry proof was incomplete or unsafe: ${cognitive_closure_recovery_proof[*]}" >&2
  exit 2
fi
export ROS_POSTGRES_CLOSURE_AUTHORIZATION_READ_PROOF_FILE="$closure_authorization_read_proof_file"
bash scripts/run-postgres-closure-authorization-read.sh
mapfile -t closure_authorization_read_proof < "$closure_authorization_read_proof_file"
if [[ "${#closure_authorization_read_proof[@]}" -ne 10 \
  || "${closure_authorization_read_proof[0]}" != "CLOSURE_AUTHORIZATION_READ_MODEL" \
  || "${closure_authorization_read_proof[1]}" != "AUTHORIZED" \
  || "${closure_authorization_read_proof[2]}" != "MISSING_JOURNAL" \
  || "${closure_authorization_read_proof[3]}" != "WITHHELD" \
  || "${closure_authorization_read_proof[4]}" != "MISMATCH" \
  || "${closure_authorization_read_proof[5]}" != "WITHHELD" \
  || "${closure_authorization_read_proof[6]}" != "ROLLBACK_RESTORED" \
  || "${closure_authorization_read_proof[7]}" != "AUTHORIZED" \
  || "${closure_authorization_read_proof[8]}" != "ROAD_EVENT_AUDIT_OUTBOX_JOURNAL" \
  || "${closure_authorization_read_proof[9]}" != "UNCHANGED" ]]; then
  echo "Post-restart closure authorization read proof was incomplete or unsafe: ${closure_authorization_read_proof[*]}" >&2
  exit 2
fi
export ROS_POSTGRES_CLOSURE_REAUTHORIZATION_PROOF_FILE="$closure_reauthorization_proof_file"
bash scripts/run-postgres-closure-reauthorization-recovery.sh
mapfile -t closure_reauthorization_proof < "$closure_reauthorization_proof_file"
if [[ "${#closure_reauthorization_proof[@]}" -ne 12 \
  || "${closure_reauthorization_proof[0]}" != "CLOSURE_REAUTHORIZATION_RECOVERY" \
  || "${closure_reauthorization_proof[1]}" != "VERIFIED" \
  || "${closure_reauthorization_proof[2]}" != "STALE_CLOSURE_ROLLBACK" \
  || "${closure_reauthorization_proof[3]}" != "UNCHANGED" \
  || "${closure_reauthorization_proof[4]}" != "REFRESH_AUTHORIZATION" \
  || "${closure_reauthorization_proof[5]}" != "WITHHELD" \
  || "${closure_reauthorization_proof[6]}" != "REPLACEMENT_AUTHORIZATION" \
  || "${closure_reauthorization_proof[7]}" != "COMMITTED" \
  || "${closure_reauthorization_proof[8]}" != "AUTHORIZATION_HISTORY" \
  || "${closure_reauthorization_proof[9]}" != "8,10" \
  || "${closure_reauthorization_proof[10]}" != "CURRENT_VERSION" \
  || "${closure_reauthorization_proof[11]}" != "10" ]]; then
  echo "Post-restart closure reauthorization proof was incomplete or unsafe: ${closure_reauthorization_proof[*]}" >&2
  exit 2
fi
readonly contact_recovery_state="$(
  psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || session.version::text || '|' || (SELECT max(revision)::text FROM ros_eye_contact_revision_ledger ledger WHERE ledger.tenant_id=event.tenant_id AND ledger.purpose=event.purpose AND ledger.case_id=event.id) || '|' || (SELECT count(*)::text FROM ros_eye_contact_audit audit WHERE audit.tenant_id=event.tenant_id AND audit.case_id=event.id::text) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NOT NULL) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NULL) FROM road_events event JOIN ros_eye_contact_sessions session ON session.tenant_id=event.tenant_id AND session.case_id=event.id::text WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response' AND event.id='10000000-0000-4000-8000-000000000005'"
)"
if [[ "$contact_recovery_system_identifier_before_restart" != "$contact_recovery_system_identifier_after_restart" \
  || "$contact_recovery_postmaster_started_at_before_restart" == "$contact_recovery_postmaster_started_at_after_restart" \
  || "$contact_recovery_state" != 'RECOVERY|2|2|2|1|1|0' ]]; then
  echo "Contact recovery did not survive a PostgreSQL restart with exact durable state: $contact_recovery_state" >&2
  exit 2
fi

set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$post_restart_duplicate_log" 2>&1 <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$ DECLARE parent_status road_event_status; parent_version integer; BEGIN
  SELECT status, version INTO parent_status, parent_version FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000005' FOR UPDATE;
  IF parent_status='CLOSED' THEN RAISE EXCEPTION 'INCIDENT_CLOSED'; END IF;
  IF parent_version<>2 THEN RAISE EXCEPTION 'PARENT_VERSION_CONFLICT'; END IF;
END $$;
DO $$ DECLARE changed integer; BEGIN
  UPDATE ros_eye_contact_sessions SET state='ESCALATED', version=2
  WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000005'
    AND session_id='contact-race-rollback' AND version=1;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'POST_RESTART_CONTACT_VERSION_CONFLICT'; END IF;
END $$;
COMMIT;
SQL
post_restart_duplicate_status=$?
set -e
readonly post_restart_duplicate_output="$(cat "$post_restart_duplicate_log")"
if [[ "$post_restart_duplicate_status" -eq 0 \
  || "$post_restart_duplicate_output" != *POST_RESTART_CONTACT_VERSION_CONFLICT* ]]; then
  echo "Post-restart duplicate contact retry bypassed its durable version boundary" >&2
  echo "$post_restart_duplicate_output" >&2
  exit 2
fi
readonly post_restart_duplicate_state="$(
  psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || session.version::text || '|' || (SELECT max(revision)::text FROM ros_eye_contact_revision_ledger ledger WHERE ledger.tenant_id=event.tenant_id AND ledger.purpose=event.purpose AND ledger.case_id=event.id) || '|' || (SELECT count(*)::text FROM ros_eye_contact_audit audit WHERE audit.tenant_id=event.tenant_id AND audit.case_id=event.id::text) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NOT NULL) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NULL) FROM road_events event JOIN ros_eye_contact_sessions session ON session.tenant_id=event.tenant_id AND session.case_id=event.id::text WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response' AND event.id='10000000-0000-4000-8000-000000000005'"
)"
if [[ "$post_restart_duplicate_state" != "$contact_recovery_state" ]]; then
  echo "Post-restart duplicate contact retry changed durable state: $post_restart_duplicate_state" >&2
  exit 2
fi

set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$post_restart_wrong_purpose_log" 2>&1 <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$ DECLARE parent_status road_event_status; parent_version integer; BEGIN
  SELECT status, version INTO parent_status, parent_version FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='traffic-coordination'
    AND id='10000000-0000-4000-8000-000000000005' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POST_RESTART_PARENT_SCOPE_MISMATCH'; END IF;
  IF parent_status='CLOSED' THEN RAISE EXCEPTION 'INCIDENT_CLOSED'; END IF;
  IF parent_version<>2 THEN RAISE EXCEPTION 'PARENT_VERSION_CONFLICT'; END IF;
END $$;
UPDATE ros_eye_contact_sessions SET state='HUMAN_REVIEW', version=3
WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000005'
  AND session_id='contact-race-rollback' AND version=2;
COMMIT;
SQL
post_restart_wrong_purpose_status=$?
set -e
readonly post_restart_wrong_purpose_output="$(cat "$post_restart_wrong_purpose_log")"
if [[ "$post_restart_wrong_purpose_status" -eq 0 \
  || "$post_restart_wrong_purpose_output" != *POST_RESTART_PARENT_SCOPE_MISMATCH* ]]; then
  echo "Wrong-purpose contact retry was not rejected at the durable parent scope boundary" >&2
  echo "$post_restart_wrong_purpose_output" >&2
  exit 2
fi
readonly post_restart_wrong_purpose_state="$(
  psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || session.version::text || '|' || (SELECT max(revision)::text FROM ros_eye_contact_revision_ledger ledger WHERE ledger.tenant_id=event.tenant_id AND ledger.purpose=event.purpose AND ledger.case_id=event.id) || '|' || (SELECT count(*)::text FROM ros_eye_contact_audit audit WHERE audit.tenant_id=event.tenant_id AND audit.case_id=event.id::text) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NOT NULL) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NULL) FROM road_events event JOIN ros_eye_contact_sessions session ON session.tenant_id=event.tenant_id AND session.case_id=event.id::text WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response' AND event.id='10000000-0000-4000-8000-000000000005'"
)"
if [[ "$post_restart_wrong_purpose_state" != "$contact_recovery_state" ]]; then
  echo "Wrong-purpose contact retry crossed its durable purpose boundary: $post_restart_wrong_purpose_state" >&2
  exit 2
fi

set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$post_restart_wrong_tenant_log" 2>&1 <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$ DECLARE parent_status road_event_status; parent_version integer; BEGIN
  SELECT status, version INTO parent_status, parent_version FROM road_events
  WHERE tenant_id='foreign-tenant' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000005' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POST_RESTART_TENANT_SCOPE_MISMATCH'; END IF;
  IF parent_status='CLOSED' THEN RAISE EXCEPTION 'INCIDENT_CLOSED'; END IF;
  IF parent_version<>2 THEN RAISE EXCEPTION 'PARENT_VERSION_CONFLICT'; END IF;
END $$;
UPDATE ros_eye_contact_sessions SET state='HUMAN_REVIEW', version=3
WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000005'
  AND session_id='contact-race-rollback' AND version=2;
COMMIT;
SQL
post_restart_wrong_tenant_status=$?
set -e
readonly post_restart_wrong_tenant_output="$(cat "$post_restart_wrong_tenant_log")"
if [[ "$post_restart_wrong_tenant_status" -eq 0 \
  || "$post_restart_wrong_tenant_output" != *POST_RESTART_TENANT_SCOPE_MISMATCH* ]]; then
  echo "Wrong-tenant contact retry was not rejected at the durable parent scope boundary" >&2
  echo "$post_restart_wrong_tenant_output" >&2
  exit 2
fi
readonly post_restart_wrong_tenant_state="$(
  psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || session.version::text || '|' || (SELECT max(revision)::text FROM ros_eye_contact_revision_ledger ledger WHERE ledger.tenant_id=event.tenant_id AND ledger.purpose=event.purpose AND ledger.case_id=event.id) || '|' || (SELECT count(*)::text FROM ros_eye_contact_audit audit WHERE audit.tenant_id=event.tenant_id AND audit.case_id=event.id::text) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NOT NULL) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NULL) FROM road_events event JOIN ros_eye_contact_sessions session ON session.tenant_id=event.tenant_id AND session.case_id=event.id::text WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response' AND event.id='10000000-0000-4000-8000-000000000005'"
)"
if [[ "$post_restart_wrong_tenant_state" != "$contact_recovery_state" ]]; then
  echo "Wrong-tenant contact retry crossed its durable tenant boundary: $post_restart_wrong_tenant_state" >&2
  exit 2
fi

set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$post_restart_wrong_case_log" 2>&1 <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$ DECLARE parent_status road_event_status; parent_version integer; BEGIN
  SELECT status, version INTO parent_status, parent_version FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000006' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POST_RESTART_CASE_SCOPE_MISMATCH'; END IF;
  IF parent_status='CLOSED' THEN RAISE EXCEPTION 'INCIDENT_CLOSED'; END IF;
  IF parent_version<>2 THEN RAISE EXCEPTION 'PARENT_VERSION_CONFLICT'; END IF;
END $$;
UPDATE ros_eye_contact_sessions SET state='HUMAN_REVIEW', version=3
WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000005'
  AND session_id='contact-race-rollback' AND version=2;
COMMIT;
SQL
post_restart_wrong_case_status=$?
set -e
readonly post_restart_wrong_case_output="$(cat "$post_restart_wrong_case_log")"
if [[ "$post_restart_wrong_case_status" -eq 0 \
  || "$post_restart_wrong_case_output" != *POST_RESTART_CASE_SCOPE_MISMATCH* ]]; then
  echo "Wrong-case contact retry was not rejected at the durable parent scope boundary" >&2
  echo "$post_restart_wrong_case_output" >&2
  exit 2
fi
readonly post_restart_wrong_case_state="$(
  psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || session.version::text || '|' || (SELECT max(revision)::text FROM ros_eye_contact_revision_ledger ledger WHERE ledger.tenant_id=event.tenant_id AND ledger.purpose=event.purpose AND ledger.case_id=event.id) || '|' || (SELECT count(*)::text FROM ros_eye_contact_audit audit WHERE audit.tenant_id=event.tenant_id AND audit.case_id=event.id::text) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NOT NULL) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NULL) FROM road_events event JOIN ros_eye_contact_sessions session ON session.tenant_id=event.tenant_id AND session.case_id=event.id::text WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response' AND event.id='10000000-0000-4000-8000-000000000005'"
)"
if [[ "$post_restart_wrong_case_state" != "$contact_recovery_state" ]]; then
  echo "Wrong-case contact retry crossed its durable case boundary: $post_restart_wrong_case_state" >&2
  exit 2
fi

set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$post_restart_stale_parent_log" 2>&1 <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$ DECLARE parent_status road_event_status; parent_version integer; BEGIN
  SELECT status, version INTO parent_status, parent_version FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000005' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POST_RESTART_PARENT_SCOPE_MISMATCH'; END IF;
  IF parent_status='CLOSED' THEN RAISE EXCEPTION 'INCIDENT_CLOSED'; END IF;
  IF parent_version<>1 THEN RAISE EXCEPTION 'POST_RESTART_PARENT_VERSION_CONFLICT'; END IF;
END $$;
UPDATE ros_eye_contact_sessions SET state='HUMAN_REVIEW', version=3
WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000005'
  AND session_id='contact-race-rollback' AND version=2;
COMMIT;
SQL
post_restart_stale_parent_status=$?
set -e
readonly post_restart_stale_parent_output="$(cat "$post_restart_stale_parent_log")"
if [[ "$post_restart_stale_parent_status" -eq 0 \
  || "$post_restart_stale_parent_output" != *POST_RESTART_PARENT_VERSION_CONFLICT* ]]; then
  echo "Stale-parent contact retry was not rejected at the durable RoadEvent version boundary" >&2
  echo "$post_restart_stale_parent_output" >&2
  exit 2
fi
readonly post_restart_stale_parent_state="$(
  psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || session.version::text || '|' || (SELECT max(revision)::text FROM ros_eye_contact_revision_ledger ledger WHERE ledger.tenant_id=event.tenant_id AND ledger.purpose=event.purpose AND ledger.case_id=event.id) || '|' || (SELECT count(*)::text FROM ros_eye_contact_audit audit WHERE audit.tenant_id=event.tenant_id AND audit.case_id=event.id::text) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NOT NULL) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NULL) FROM road_events event JOIN ros_eye_contact_sessions session ON session.tenant_id=event.tenant_id AND session.case_id=event.id::text WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response' AND event.id='10000000-0000-4000-8000-000000000005'"
)"
if [[ "$post_restart_stale_parent_state" != "$contact_recovery_state" ]]; then
  echo "Stale-parent contact retry changed durable state: $post_restart_stale_parent_state" >&2
  exit 2
fi

set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$post_restart_closed_parent_log" 2>&1 <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $$ DECLARE parent_status road_event_status; parent_version integer; BEGIN
  SELECT status, version INTO parent_status, parent_version FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000004' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POST_RESTART_PARENT_SCOPE_MISMATCH'; END IF;
  IF parent_status='CLOSED' THEN RAISE EXCEPTION 'POST_RESTART_INCIDENT_CLOSED'; END IF;
  IF parent_version<>3 THEN RAISE EXCEPTION 'POST_RESTART_PARENT_VERSION_CONFLICT'; END IF;
END $$;
UPDATE ros_eye_contact_sessions SET state='ESCALATED', version=2
WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004'
  AND session_id='contact-race-closure-wins' AND version=1;
COMMIT;
SQL
post_restart_closed_parent_status=$?
set -e
readonly post_restart_closed_parent_output="$(cat "$post_restart_closed_parent_log")"
if [[ "$post_restart_closed_parent_status" -eq 0 \
  || "$post_restart_closed_parent_output" != *POST_RESTART_INCIDENT_CLOSED* ]]; then
  echo "Closed-parent contact retry was not rejected after PostgreSQL restart" >&2
  echo "$post_restart_closed_parent_output" >&2
  exit 2
fi
readonly post_restart_closed_parent_state="$(
  psql "$DATABASE_URL" -Atqc "SELECT event.status::text || '|' || event.version::text || '|' || session.version::text || '|' || (SELECT max(revision)::text FROM ros_eye_contact_revision_ledger ledger WHERE ledger.tenant_id=event.tenant_id AND ledger.purpose=event.purpose AND ledger.case_id=event.id) || '|' || (SELECT count(*)::text FROM ros_eye_contact_audit audit WHERE audit.tenant_id=event.tenant_id AND audit.case_id=event.id::text) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NOT NULL) || '|' || (SELECT count(*)::text FROM ros_eye_contact_outbox outbox WHERE outbox.tenant_id=event.tenant_id AND outbox.case_id=event.id::text AND outbox.cancelled_at IS NULL) FROM road_events event JOIN ros_eye_contact_sessions session ON session.tenant_id=event.tenant_id AND session.case_id=event.id::text WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response' AND event.id='10000000-0000-4000-8000-000000000004'"
)"
if [[ "$post_restart_closed_parent_state" != 'CLOSED|3|1|1|0|0|1' ]]; then
  echo "Closed-parent contact retry changed durable state: $post_restart_closed_parent_state" >&2
  exit 2
fi

readonly closed_parent_outbox_claim_result="$(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
\set QUIET 1
BEGIN;
\set QUIET 0
WITH due AS (
  SELECT message.tenant_id, message.case_id, message.session_id, message.message_id
  FROM ros_eye_contact_outbox AS message
  WHERE message.tenant_id='riyadh-pilot'
    AND message.case_id='10000000-0000-4000-8000-000000000004'
    AND message.session_id='contact-race-closure-wins'
    AND message.message_id='pending-contact-action'
    AND message.delivered_at IS NULL AND message.cancelled_at IS NULL
    AND message.available_at <= clock_timestamp()
    AND (message.lease_expires_at IS NULL OR message.lease_expires_at <= clock_timestamp()
      OR message.delivery_deadline_at <= clock_timestamp())
    AND (message.delivery_token IS NULL OR message.delivery_deadline_at <= clock_timestamp())
    AND EXISTS (
      SELECT 1 FROM road_events AS parent
      WHERE parent.tenant_id=message.tenant_id AND parent.id::text=message.case_id
        AND parent.status <> 'CLOSED'
    )
  FOR UPDATE SKIP LOCKED
  LIMIT 1
), claimed AS (
  UPDATE ros_eye_contact_outbox AS message
  SET lease_owner='closed-parent-proof-worker',
      lease_expires_at=clock_timestamp() + interval '30 seconds',
      delivery_token=NULL, delivery_started_at=NULL, delivery_deadline_at=NULL
  FROM due
  WHERE message.tenant_id=due.tenant_id AND message.case_id=due.case_id
    AND message.session_id=due.session_id AND message.message_id=due.message_id
  RETURNING message.message_id
)
SELECT CASE WHEN count(*)=0 THEN 'NOT_CLAIMED' ELSE 'CLAIMED' END FROM claimed;
\set QUIET 1
ROLLBACK;
SQL
)"
if [[ "$closed_parent_outbox_claim_result" != 'NOT_CLAIMED' ]]; then
  echo "Closed-parent Contact outbox row was claimable: $closed_parent_outbox_claim_result" >&2
  exit 2
fi

readonly closed_parent_outbox_reservation_result="$(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
\set QUIET 1
BEGIN;
UPDATE ros_eye_contact_outbox
SET lease_owner='pre-closure-proof-worker',
    lease_expires_at=clock_timestamp() + interval '30 seconds'
WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004'
  AND session_id='contact-race-closure-wins' AND message_id='pending-contact-action';
\set QUIET 0
WITH reserved AS (
  UPDATE ros_eye_contact_outbox AS message
  SET delivery_token='closed-parent-proof-token', delivery_started_at=clock_timestamp(),
      delivery_deadline_at=clock_timestamp() + interval '5 seconds'
  WHERE message.tenant_id='riyadh-pilot'
    AND message.case_id='10000000-0000-4000-8000-000000000004'
    AND message.session_id='contact-race-closure-wins'
    AND message.message_id='pending-contact-action'
    AND message.lease_owner='pre-closure-proof-worker'
    AND message.lease_expires_at > clock_timestamp()
    AND message.delivered_at IS NULL AND message.cancelled_at IS NULL
    AND (message.delivery_token IS NULL OR message.delivery_deadline_at <= clock_timestamp())
    AND EXISTS (
      SELECT 1 FROM road_events AS parent
      WHERE parent.tenant_id=message.tenant_id AND parent.id::text=message.case_id
        AND parent.status <> 'CLOSED'
    )
  RETURNING message.message_id
)
SELECT CASE WHEN count(*)=0 THEN 'NOT_RESERVED|PROVIDER_NOT_ENTERED'
  ELSE 'RESERVED|PROVIDER_ENTERED' END FROM reserved;
\set QUIET 1
ROLLBACK;
SQL
)"
if [[ "$closed_parent_outbox_reservation_result" != 'NOT_RESERVED|PROVIDER_NOT_ENTERED' ]]; then
  echo "Closed-parent Contact delivery crossed its provider fence: $closed_parent_outbox_reservation_result" >&2
  exit 2
fi

readonly closed_parent_outbox_state="$(
  psql "$DATABASE_URL" -Atqc "SELECT count(*)::text || '|' || count(*) FILTER (WHERE lease_owner IS NULL)::text || '|' || count(*) FILTER (WHERE delivery_token IS NULL)::text FROM ros_eye_contact_outbox WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004' AND session_id='contact-race-closure-wins' AND message_id='pending-contact-action' AND delivered_at IS NULL AND cancelled_at IS NULL"
)"
if [[ "$closed_parent_outbox_state" != '1|1|1' ]]; then
  echo "Closed-parent outbox proof changed the pending message: $closed_parent_outbox_state" >&2
  exit 2
fi

readonly closed_parent_outbox_finalization_result="$(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
\set QUIET 1
BEGIN;
UPDATE ros_eye_contact_outbox
SET lease_owner='pre-closure-finalization-worker',
    lease_expires_at=clock_timestamp() + interval '30 seconds',
    delivery_token='closed-parent-finalization-token',
    delivery_started_at=clock_timestamp(),
    delivery_deadline_at=clock_timestamp() + interval '5 seconds'
WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004'
  AND session_id='contact-race-closure-wins' AND message_id='pending-contact-action';
CREATE TEMP TABLE closed_parent_finalization_proof (
  delivered_count bigint NOT NULL,
  retry_count bigint NOT NULL DEFAULT 0
) ON COMMIT DROP;
WITH delivered AS (
  UPDATE ros_eye_contact_outbox AS message
  SET delivered_at=clock_timestamp(), lease_owner=NULL, lease_expires_at=NULL,
      delivery_token=NULL, delivery_started_at=NULL, delivery_deadline_at=NULL,
      last_error=NULL, last_error_code=NULL
  WHERE message.tenant_id='riyadh-pilot'
    AND message.case_id='10000000-0000-4000-8000-000000000004'
    AND message.session_id='contact-race-closure-wins'
    AND message.message_id='pending-contact-action'
    AND message.lease_owner='pre-closure-finalization-worker'
    AND message.delivery_token='closed-parent-finalization-token'
    AND message.delivery_deadline_at >= clock_timestamp()
    AND message.delivered_at IS NULL AND message.cancelled_at IS NULL
    AND EXISTS (
      SELECT 1 FROM road_events AS parent
      WHERE parent.tenant_id=message.tenant_id AND parent.id::text=message.case_id
        AND parent.status <> 'CLOSED'
    )
  RETURNING 1
)
INSERT INTO closed_parent_finalization_proof (delivered_count)
SELECT count(*) FROM delivered;
WITH retried AS (
  UPDATE ros_eye_contact_outbox AS message
  SET attempt_count=message.attempt_count + 1,
      available_at=clock_timestamp() + interval '15 seconds',
      lease_owner=NULL, lease_expires_at=NULL,
      delivery_token=NULL, delivery_started_at=NULL, delivery_deadline_at=NULL,
      last_error='closed-parent-finalization-proof', last_error_code='PROVIDER_FAILURE'
  WHERE message.tenant_id='riyadh-pilot'
    AND message.case_id='10000000-0000-4000-8000-000000000004'
    AND message.session_id='contact-race-closure-wins'
    AND message.message_id='pending-contact-action'
    AND message.lease_owner='pre-closure-finalization-worker'
    AND message.delivery_token='closed-parent-finalization-token'
    AND message.delivery_deadline_at >= clock_timestamp()
    AND message.delivered_at IS NULL AND message.cancelled_at IS NULL
    AND EXISTS (
      SELECT 1 FROM road_events AS parent
      WHERE parent.tenant_id=message.tenant_id AND parent.id::text=message.case_id
        AND parent.status <> 'CLOSED'
    )
  RETURNING 1
)
UPDATE closed_parent_finalization_proof
SET retry_count=(SELECT count(*) FROM retried);
\set QUIET 0
SELECT CASE
  WHEN proof.delivered_count=0 AND proof.retry_count=0
    AND parent.status='CLOSED'
    AND message.lease_owner='pre-closure-finalization-worker'
    AND message.delivery_token='closed-parent-finalization-token'
    AND message.delivered_at IS NULL AND message.cancelled_at IS NULL
    AND message.last_error IS NULL AND message.last_error_code IS NULL
  THEN 'DELIVERY_NOT_RECORDED|RETRY_NOT_RECORDED|PARENT_CLOSED|RESERVATION_UNCHANGED'
  ELSE 'UNSAFE_FINALIZATION_RESULT'
END
FROM closed_parent_finalization_proof AS proof
JOIN ros_eye_contact_outbox AS message
  ON message.tenant_id='riyadh-pilot'
  AND message.case_id='10000000-0000-4000-8000-000000000004'
  AND message.session_id='contact-race-closure-wins'
  AND message.message_id='pending-contact-action'
JOIN road_events AS parent
  ON parent.tenant_id=message.tenant_id AND parent.id::text=message.case_id;
\set QUIET 1
ROLLBACK;
SQL
)"
if [[ "$closed_parent_outbox_finalization_result" != 'DELIVERY_NOT_RECORDED|RETRY_NOT_RECORDED|PARENT_CLOSED|RESERVATION_UNCHANGED' ]]; then
  echo "Closed-parent Contact result crossed its durable finalization fence: $closed_parent_outbox_finalization_result" >&2
  exit 2
fi

readonly closed_parent_outbox_state_after_finalization="$(
  psql "$DATABASE_URL" -Atqc "SELECT count(*)::text || '|' || count(*) FILTER (WHERE lease_owner IS NULL)::text || '|' || count(*) FILTER (WHERE delivery_token IS NULL)::text FROM ros_eye_contact_outbox WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004' AND session_id='contact-race-closure-wins' AND message_id='pending-contact-action' AND delivered_at IS NULL AND cancelled_at IS NULL"
)"
if [[ "$closed_parent_outbox_state_after_finalization" != '1|1|1' ]]; then
  echo "Closed-parent finalization proof escaped rollback: $closed_parent_outbox_state_after_finalization" >&2
  exit 2
fi

readonly closed_parent_provider_result='SENT'
record_closed_parent_ambiguity() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
WITH candidate AS (
  SELECT session.state, session.version
  FROM ros_eye_contact_outbox AS message
  JOIN ros_eye_contact_sessions AS session
    ON session.tenant_id=message.tenant_id
    AND session.case_id=message.case_id
    AND session.session_id=message.session_id
  LEFT JOIN road_events AS parent
    ON parent.tenant_id=message.tenant_id AND parent.id::text=message.case_id
  WHERE message.tenant_id='riyadh-pilot'
    AND message.case_id='10000000-0000-4000-8000-000000000004'
    AND message.session_id='contact-race-closure-wins'
    AND message.message_id='pending-contact-action'
    AND (message.cancelled_at IS NOT NULL OR parent.status='CLOSED')
), inserted AS (
  INSERT INTO ros_eye_contact_audit (
    tenant_id, case_id, session_id, event_id, event_type, state, session_version,
    actor_type, actor_id, authorized_by_role, authority_policy_version,
    reason_code, occurred_at, trace_id, runtime_policy_version
  )
  SELECT 'riyadh-pilot', '10000000-0000-4000-8000-000000000004',
    'contact-race-closure-wins', 'delivery-result-ambiguous-pending-contact-action',
    'DELIVERY_RESULT_AMBIGUOUS', candidate.state, candidate.version,
    'SYSTEM', 'pre-closure-finalization-worker', 'SYSTEM',
    'ros-eye.contact-authority.v1', 'provider_sent_after_delivery_fence',
    clock_timestamp(), 'pending-contact-action', 'ros-eye.contact-runtime.v6'
  FROM candidate
  ON CONFLICT DO NOTHING
  RETURNING event_id
)
SELECT event_id FROM inserted
UNION ALL
SELECT event_id FROM ros_eye_contact_audit
WHERE tenant_id='riyadh-pilot'
  AND case_id='10000000-0000-4000-8000-000000000004'
  AND session_id='contact-race-closure-wins'
  AND event_id='delivery-result-ambiguous-pending-contact-action'
LIMIT 1;
SQL
}

readonly closed_parent_ambiguity_audit_first="$(record_closed_parent_ambiguity)"
if [[ "$closed_parent_ambiguity_audit_first" != 'delivery-result-ambiguous-pending-contact-action' ]]; then
  echo "Ambiguous provider result was not durably audited before human review" >&2
  exit 2
fi

# A second psql process represents a restarted worker replaying the exact result.
readonly closed_parent_ambiguity_audit_replay="$(record_closed_parent_ambiguity)"
if [[ "$closed_parent_ambiguity_audit_replay" != "$closed_parent_ambiguity_audit_first" ]]; then
  echo "Ambiguous provider audit replay was not exact and idempotent" >&2
  exit 2
fi

readonly closed_parent_ambiguity_audit_state="$(
  psql "$DATABASE_URL" -Atqc "SELECT count(*)::text || '|' || count(*) FILTER (WHERE event_id='delivery-result-ambiguous-pending-contact-action' AND reason_code='provider_sent_after_delivery_fence' AND trace_id='pending-contact-action')::text || '|' || CASE WHEN bool_and(position('closed-parent-finalization-token' in concat_ws('|', event_id, event_type, actor_id, reason_code, trace_id, authority_policy_version, runtime_policy_version))=0) THEN 'TOKEN_EXCLUDED' ELSE 'TOKEN_EXPOSED' END FROM ros_eye_contact_audit WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004' AND session_id='contact-race-closure-wins' AND event_type='DELIVERY_RESULT_AMBIGUOUS'"
)"
if [[ "$closed_parent_ambiguity_audit_state" != '1|1|TOKEN_EXCLUDED' ]]; then
  echo "Ambiguous provider audit was duplicated, incomplete, or exposed its delivery token: $closed_parent_ambiguity_audit_state" >&2
  exit 2
fi

closed_parent_provider_disposition='CONFLICT'
if [[ "$closed_parent_provider_result" == 'SENT' \
  && "$closed_parent_outbox_finalization_result" == 'DELIVERY_NOT_RECORDED|RETRY_NOT_RECORDED|PARENT_CLOSED|RESERVATION_UNCHANGED' \
  && "$closed_parent_ambiguity_audit_state" == '1|1|TOKEN_EXCLUDED' ]]; then
  closed_parent_provider_disposition='HUMAN_REVIEW'
fi
readonly closed_parent_provider_disposition
if [[ "$closed_parent_provider_disposition" != 'HUMAN_REVIEW' ]]; then
  echo "Durably audited ambiguous provider success did not escalate to human review" >&2
  exit 2
fi

readonly closed_parent_outbox_hash_before_recovery="$(
  psql "$DATABASE_URL" -Atqc "SELECT md5(to_jsonb(message)::text) FROM ros_eye_contact_outbox AS message WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004' AND session_id='contact-race-closure-wins' AND message_id='pending-contact-action'"
)"
readonly closed_parent_ambiguity_recovery_result="$(
  psql "$DATABASE_URL" -Atqc "WITH status AS (SELECT message.delivered_at, message.cancelled_at, parent.status AS parent_status, EXISTS (SELECT 1 FROM ros_eye_contact_audit AS audit WHERE audit.tenant_id=message.tenant_id AND audit.case_id=message.case_id AND audit.session_id=message.session_id AND audit.event_id='delivery-result-ambiguous-' || message.message_id AND audit.event_type='DELIVERY_RESULT_AMBIGUOUS') AS ambiguity_recorded FROM ros_eye_contact_outbox AS message LEFT JOIN road_events AS parent ON parent.tenant_id=message.tenant_id AND parent.id::text=message.case_id WHERE message.tenant_id='riyadh-pilot' AND message.case_id='10000000-0000-4000-8000-000000000004' AND message.session_id='contact-race-closure-wins' AND message.message_id='pending-contact-action') SELECT CASE WHEN ambiguity_recorded THEN 'HUMAN_REVIEW|PROVIDER_NOT_ENTERED' WHEN parent_status='CLOSED' OR cancelled_at IS NOT NULL THEN 'CANCELLED|PROVIDER_NOT_ENTERED' WHEN delivered_at IS NOT NULL THEN 'DELIVERED|PROVIDER_NOT_ENTERED' ELSE 'CONFLICT|PROVIDER_NOT_ENTERED' END FROM status"
)"
if [[ "$closed_parent_ambiguity_recovery_result" != 'HUMAN_REVIEW|PROVIDER_NOT_ENTERED' ]]; then
  echo "Restarted Contact worker did not recover durable ambiguity without provider entry: $closed_parent_ambiguity_recovery_result" >&2
  exit 2
fi

readonly closed_parent_outbox_state_after_recovery="$(
  psql "$DATABASE_URL" -Atqc "SELECT count(*)::text || '|' || count(*) FILTER (WHERE lease_owner IS NULL)::text || '|' || count(*) FILTER (WHERE delivery_token IS NULL)::text FROM ros_eye_contact_outbox WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004' AND session_id='contact-race-closure-wins' AND message_id='pending-contact-action' AND delivered_at IS NULL AND cancelled_at IS NULL"
)"
readonly closed_parent_outbox_hash_after_recovery="$(
  psql "$DATABASE_URL" -Atqc "SELECT md5(to_jsonb(message)::text) FROM ros_eye_contact_outbox AS message WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004' AND session_id='contact-race-closure-wins' AND message_id='pending-contact-action'"
)"
if [[ ! "$closed_parent_outbox_hash_before_recovery" =~ ^[a-f0-9]{32}$ \
  || "$closed_parent_outbox_hash_after_recovery" != "$closed_parent_outbox_hash_before_recovery" \
  || "$closed_parent_outbox_state_after_recovery" != "$closed_parent_outbox_state_after_finalization" ]]; then
  echo "Ambiguity recovery mutated Contact outbox state: $closed_parent_outbox_state_after_recovery" >&2
  exit 2
fi

# The operator-facing Human Safety read gives unresolved delivery ambiguity
# precedence over the terminal parent label without reopening the RoadEvent.
readonly closed_parent_human_safety_state="$(
  psql "$DATABASE_URL" -Atqc "WITH candidate AS (SELECT parent.status AS parent_status, EXISTS (SELECT 1 FROM ros_eye_contact_audit AS audit WHERE audit.tenant_id=parent.tenant_id AND audit.case_id=parent.id::text AND audit.session_id='contact-race-closure-wins' AND audit.event_id='delivery-result-ambiguous-pending-contact-action' AND audit.event_type='DELIVERY_RESULT_AMBIGUOUS') AS ambiguity_recorded FROM road_events AS parent WHERE parent.tenant_id='riyadh-pilot' AND parent.purpose='TRAFFIC_COORDINATION' AND parent.id='10000000-0000-4000-8000-000000000004'::uuid) SELECT CASE WHEN ambiguity_recorded THEN 'HUMAN_REVIEW|PARENT_CLOSED' WHEN parent_status='CLOSED' THEN 'RESOLVED|PARENT_CLOSED' ELSE 'CONFLICT|PARENT_OPEN' END FROM candidate"
)"
if [[ "$closed_parent_human_safety_state" != 'HUMAN_REVIEW|PARENT_CLOSED' ]]; then
  echo "Durable Contact ambiguity was hidden by the closed parent state: $closed_parent_human_safety_state" >&2
  exit 2
fi
readonly closed_parent_outbox_hash_after_human_safety_read="$(
  psql "$DATABASE_URL" -Atqc "SELECT md5(to_jsonb(message)::text) FROM ros_eye_contact_outbox AS message WHERE tenant_id='riyadh-pilot' AND case_id='10000000-0000-4000-8000-000000000004' AND session_id='contact-race-closure-wins' AND message_id='pending-contact-action'"
)"
if [[ "$closed_parent_outbox_hash_after_human_safety_read" != "$closed_parent_outbox_hash_after_recovery" ]]; then
  echo "Human Safety ambiguity visibility mutated Contact outbox state" >&2
  exit 2
fi

image_id="$("$container_engine" inspect --format '{{.Image}}' "$container_name")"
if [[ "$image_id" =~ ^[a-f0-9]{64}$ ]]; then image_id="sha256:${image_id}"; fi
readonly image_id
readonly postgres_version="$(psql "$DATABASE_URL" -Atqc 'SHOW server_version')"
readonly postgis_version="$(psql "$DATABASE_URL" -Atqc 'SELECT postgis_lib_version()')"
readonly database_system_identifier="$(
  psql "$DATABASE_URL" -Atqc 'SELECT system_identifier::text FROM pg_control_system()'
)"
readonly postmaster_started_at="$(psql "$DATABASE_URL" -Atqc 'SELECT pg_postmaster_start_time()::text')"

if [[ ! "$candidate_sha" =~ ^[a-f0-9]{40}$ \
  || ! "$journey_manifest_sha256" =~ ^[a-f0-9]{64}$ \
  || ! "$image_id" =~ ^sha256:[a-f0-9]{64}$ \
  || -z "$postgres_version" \
  || -z "$postgis_version" \
  || ! "$database_system_identifier" =~ ^[0-9]+$ \
  || -z "$postmaster_started_at" \
  || ! "$system_identifier_before_restart" =~ ^[0-9]+$ \
  || "$system_identifier_before_restart" != "$system_identifier_after_restart" \
  || "$system_identifier_after_restart" != "$database_system_identifier" \
  || "$contact_recovery_system_identifier_before_restart" != "$system_identifier_after_restart" \
  || "$contact_recovery_system_identifier_after_restart" != "$database_system_identifier" \
  || -z "$postmaster_started_at_before_restart" \
  || -z "$postmaster_started_at_after_restart" \
  || "$postmaster_started_at_before_restart" == "$postmaster_started_at_after_restart" \
  || "$postmaster_started_at_after_restart" != "$contact_recovery_postmaster_started_at_before_restart" \
  || "$contact_recovery_postmaster_started_at_before_restart" == "$contact_recovery_postmaster_started_at_after_restart" \
  || "$contact_recovery_postmaster_started_at_after_restart" != "$postmaster_started_at" ]]; then
  echo "PostgreSQL journey passed but its local receipt provenance is incomplete" >&2
  exit 2
fi

ROS_RECEIPT_CANDIDATE_SHA="$candidate_sha" \
ROS_RECEIPT_JOURNEY_MANIFEST_SHA256="$journey_manifest_sha256" \
ROS_RECEIPT_CONTAINER_ENGINE="$container_engine" \
ROS_RECEIPT_IMAGE_ID="$image_id" \
ROS_RECEIPT_POSTGRES_VERSION="$postgres_version" \
ROS_RECEIPT_POSTGIS_VERSION="$postgis_version" \
ROS_RECEIPT_DATABASE_SYSTEM_IDENTIFIER="$database_system_identifier" \
ROS_RECEIPT_POSTMASTER_STARTED_AT_BEFORE_RESTART="$postmaster_started_at_before_restart" \
ROS_RECEIPT_POSTMASTER_STARTED_AT_AFTER_RESTART="$postmaster_started_at_after_restart" \
ROS_RECEIPT_CLOSURE_RACE_WINNER="${closure_race_proof[0]}" \
ROS_RECEIPT_CLOSURE_RACE_LOSER_RESULT="${closure_race_proof[3]}" \
ROS_RECEIPT_REVERSE_RACE_WINNER="${closure_race_proof[4]}" \
ROS_RECEIPT_REVERSE_RACE_LOSER_RESULT="${closure_race_proof[7]}" \
ROS_RECEIPT_CONTACT_RACE_WINNER="${contact_closure_race_proof[0]}" \
ROS_RECEIPT_CONTACT_RACE_LOSER_RESULT="${contact_closure_race_proof[3]}" \
ROS_RECEIPT_REVERSE_CONTACT_RACE_WINNER="${contact_closure_race_proof[4]}" \
ROS_RECEIPT_REVERSE_CONTACT_RACE_LOSER_RESULT="${contact_closure_race_proof[7]}" \
ROS_RECEIPT_CONTACT_ATOMIC_ROLLBACK="${contact_closure_race_proof[9]}" \
ROS_RECEIPT_CONTACT_FORWARD_RETRY="${contact_closure_race_proof[11]}" \
ROS_RECEIPT_CONTACT_DUPLICATE_RETRY="${contact_closure_race_proof[13]}" \
ROS_RECEIPT_CONTACT_RECOVERY_STATE="$contact_recovery_state" \
ROS_RECEIPT_CONTACT_RECOVERY_POSTMASTER_BEFORE="$contact_recovery_postmaster_started_at_before_restart" \
ROS_RECEIPT_CONTACT_RECOVERY_POSTMASTER_AFTER="$contact_recovery_postmaster_started_at_after_restart" \
ROS_RECEIPT_CONTACT_POST_RESTART_DUPLICATE_STATE="$post_restart_duplicate_state" \
ROS_RECEIPT_CONTACT_WRONG_PURPOSE_STATE="$post_restart_wrong_purpose_state" \
ROS_RECEIPT_CONTACT_WRONG_TENANT_STATE="$post_restart_wrong_tenant_state" \
ROS_RECEIPT_CONTACT_WRONG_CASE_STATE="$post_restart_wrong_case_state" \
ROS_RECEIPT_CONTACT_STALE_PARENT_STATE="$post_restart_stale_parent_state" \
ROS_RECEIPT_CONTACT_CLOSED_PARENT_STATE="$post_restart_closed_parent_state" \
ROS_RECEIPT_CONTACT_CLOSED_PARENT_OUTBOX_STATE="$closed_parent_outbox_state" \
ROS_RECEIPT_CONTACT_CLOSED_PARENT_OUTBOX_STATE_AFTER_FINALIZATION="$closed_parent_outbox_state_after_finalization" \
ROS_RECEIPT_CONTACT_CLOSED_PARENT_PROVIDER_RESULT="$closed_parent_provider_result" \
ROS_RECEIPT_CONTACT_CLOSED_PARENT_PROVIDER_DISPOSITION="$closed_parent_provider_disposition" \
ROS_RECEIPT_CONTACT_AMBIGUITY_AUDIT_FIRST="$closed_parent_ambiguity_audit_first" \
ROS_RECEIPT_CONTACT_AMBIGUITY_AUDIT_REPLAY="$closed_parent_ambiguity_audit_replay" \
ROS_RECEIPT_CONTACT_AMBIGUITY_AUDIT_STATE="$closed_parent_ambiguity_audit_state" \
ROS_RECEIPT_CONTACT_AMBIGUITY_RECOVERY="$closed_parent_ambiguity_recovery_result" \
ROS_RECEIPT_CONTACT_AMBIGUITY_RECOVERY_OUTBOX_STATE="$closed_parent_outbox_state_after_recovery" \
ROS_RECEIPT_CONTACT_AMBIGUITY_RECOVERY_OUTBOX_HASH_BEFORE="$closed_parent_outbox_hash_before_recovery" \
ROS_RECEIPT_CONTACT_AMBIGUITY_RECOVERY_OUTBOX_HASH_AFTER="$closed_parent_outbox_hash_after_recovery" \
ROS_RECEIPT_CONTACT_AMBIGUITY_HUMAN_SAFETY_STATE="$closed_parent_human_safety_state" \
ROS_RECEIPT_CONTACT_AMBIGUITY_HUMAN_SAFETY_OUTBOX_HASH="$closed_parent_outbox_hash_after_human_safety_read" \
ROS_RECEIPT_COGNITIVE_CLOSURE_DRIFT="${cognitive_closure_proof[1]}" \
ROS_RECEIPT_COGNITIVE_CLOSURE_WRITE_SET="${cognitive_closure_proof[3]}" \
ROS_RECEIPT_COGNITIVE_CLOSURE_AUTHORIZATION_HISTORY="${cognitive_closure_proof[5]}" \
ROS_RECEIPT_COGNITIVE_CLOSURE_STATE_BEFORE_RESTART="$cognitive_closure_state_before_restart" \
ROS_RECEIPT_COGNITIVE_CLOSURE_STATE_AFTER_RESTART="$cognitive_closure_state_after_restart" \
ROS_RECEIPT_CLOSURE_AUTHORIZATION_JOURNAL_MUTATION="${cognitive_closure_proof[9]}" \
ROS_RECEIPT_CLOSURE_AUTHORIZATION_JOURNAL_STATE_BEFORE_RESTART="$closure_authorization_journal_state_before_restart" \
ROS_RECEIPT_CLOSURE_AUTHORIZATION_JOURNAL_STATE_AFTER_RESTART="$closure_authorization_journal_state_after_restart" \
ROS_RECEIPT_COGNITIVE_CLOSURE_RECOVERY_RETRY="${cognitive_closure_recovery_proof[1]}" \
ROS_RECEIPT_COGNITIVE_CLOSURE_RECOVERY_WRITE_SET="${cognitive_closure_recovery_proof[3]}" \
ROS_RECEIPT_COGNITIVE_CLOSURE_RECOVERY_AUTHORIZATION_HISTORY="${cognitive_closure_recovery_proof[5]}" \
ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_EXACT="${closure_authorization_read_proof[1]}" \
ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_MISSING="${closure_authorization_read_proof[3]}" \
ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_MISMATCH="${closure_authorization_read_proof[5]}" \
ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_ROLLBACK="${closure_authorization_read_proof[7]}" \
ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_WRITE_SET="${closure_authorization_read_proof[9]}" \
ROS_RECEIPT_CLOSURE_REAUTHORIZATION_STALE_ROLLBACK="${closure_reauthorization_proof[3]}" \
ROS_RECEIPT_CLOSURE_REAUTHORIZATION_REFRESH="${closure_reauthorization_proof[5]}" \
ROS_RECEIPT_CLOSURE_REAUTHORIZATION_REPLACEMENT="${closure_reauthorization_proof[7]}" \
ROS_RECEIPT_CLOSURE_REAUTHORIZATION_HISTORY="${closure_reauthorization_proof[9]}" \
ROS_RECEIPT_CLOSURE_REAUTHORIZATION_CURRENT_VERSION="${closure_reauthorization_proof[11]}" \
node -e '
  const receipt = {
    schemaVersion: "ros-brain.local-postgres-journey-receipt.v30",
    candidateSha: process.env.ROS_RECEIPT_CANDIDATE_SHA,
    journeyManifestSha256: process.env.ROS_RECEIPT_JOURNEY_MANIFEST_SHA256,
    containerEngine: process.env.ROS_RECEIPT_CONTAINER_ENGINE,
    containerImageId: process.env.ROS_RECEIPT_IMAGE_ID,
    postgresVersion: process.env.ROS_RECEIPT_POSTGRES_VERSION,
    postgisVersion: process.env.ROS_RECEIPT_POSTGIS_VERSION,
    databaseSystemIdentifier: process.env.ROS_RECEIPT_DATABASE_SYSTEM_IDENTIFIER,
    postmasterStartedAtBeforeRestart:
      process.env.ROS_RECEIPT_POSTMASTER_STARTED_AT_BEFORE_RESTART,
    postmasterStartedAtAfterRestart:
      process.env.ROS_RECEIPT_POSTMASTER_STARTED_AT_AFTER_RESTART,
    restartVerified: true,
    closureRaceVerified: true,
    closureRaceWinner: process.env.ROS_RECEIPT_CLOSURE_RACE_WINNER,
    closureRaceLoserResult: process.env.ROS_RECEIPT_CLOSURE_RACE_LOSER_RESULT,
    reverseRaceWinner: process.env.ROS_RECEIPT_REVERSE_RACE_WINNER,
    reverseRaceLoserResult: process.env.ROS_RECEIPT_REVERSE_RACE_LOSER_RESULT,
    contactClosureRaceVerified: true,
    contactRaceWinner: process.env.ROS_RECEIPT_CONTACT_RACE_WINNER,
    contactRaceLoserResult: process.env.ROS_RECEIPT_CONTACT_RACE_LOSER_RESULT,
    reverseContactRaceWinner: process.env.ROS_RECEIPT_REVERSE_CONTACT_RACE_WINNER,
    reverseContactRaceLoserResult: process.env.ROS_RECEIPT_REVERSE_CONTACT_RACE_LOSER_RESULT,
    contactAtomicRollback: process.env.ROS_RECEIPT_CONTACT_ATOMIC_ROLLBACK,
    contactForwardRetry: process.env.ROS_RECEIPT_CONTACT_FORWARD_RETRY,
    contactDuplicateRetry: process.env.ROS_RECEIPT_CONTACT_DUPLICATE_RETRY,
    contactRecoveryRestartVerified: true,
    contactRecoveryState: process.env.ROS_RECEIPT_CONTACT_RECOVERY_STATE,
    contactRecoveryPostmasterStartedAtBeforeRestart:
      process.env.ROS_RECEIPT_CONTACT_RECOVERY_POSTMASTER_BEFORE,
    contactRecoveryPostmasterStartedAtAfterRestart:
      process.env.ROS_RECEIPT_CONTACT_RECOVERY_POSTMASTER_AFTER,
    contactPostRestartDuplicateRetry: "REJECTED",
    contactPostRestartDuplicateState:
      process.env.ROS_RECEIPT_CONTACT_POST_RESTART_DUPLICATE_STATE,
    contactWrongPurposeRetry: "REJECTED",
    contactWrongPurposeState:
      process.env.ROS_RECEIPT_CONTACT_WRONG_PURPOSE_STATE,
    contactWrongTenantRetry: "REJECTED",
    contactWrongTenantState:
      process.env.ROS_RECEIPT_CONTACT_WRONG_TENANT_STATE,
    contactWrongCaseRetry: "REJECTED",
    contactWrongCaseState:
      process.env.ROS_RECEIPT_CONTACT_WRONG_CASE_STATE,
    contactStaleParentRetry: "REJECTED",
    contactStaleParentState:
      process.env.ROS_RECEIPT_CONTACT_STALE_PARENT_STATE,
    contactClosedParentRetry: "REJECTED",
    contactClosedParentState:
      process.env.ROS_RECEIPT_CONTACT_CLOSED_PARENT_STATE,
    contactClosedParentOutboxClaim: "NOT_CLAIMED",
    contactClosedParentDeliveryReservation: "NOT_RESERVED",
    contactClosedParentProviderCallback: "NOT_ENTERED",
    contactClosedParentOutboxState:
      process.env.ROS_RECEIPT_CONTACT_CLOSED_PARENT_OUTBOX_STATE,
    contactClosedParentDeliveredFinalization: "NOT_RECORDED",
    contactClosedParentRetryFinalization: "NOT_RECORDED",
    contactClosedParentReservationAfterFinalization: "UNCHANGED",
    contactClosedParentOutboxStateAfterFinalization:
      process.env.ROS_RECEIPT_CONTACT_CLOSED_PARENT_OUTBOX_STATE_AFTER_FINALIZATION,
    contactClosedParentProviderResult:
      process.env.ROS_RECEIPT_CONTACT_CLOSED_PARENT_PROVIDER_RESULT,
    contactClosedParentProviderDisposition:
      process.env.ROS_RECEIPT_CONTACT_CLOSED_PARENT_PROVIDER_DISPOSITION,
    contactAmbiguityAuditFirst:
      process.env.ROS_RECEIPT_CONTACT_AMBIGUITY_AUDIT_FIRST,
    contactAmbiguityAuditReplay:
      process.env.ROS_RECEIPT_CONTACT_AMBIGUITY_AUDIT_REPLAY,
    contactAmbiguityAuditState:
      process.env.ROS_RECEIPT_CONTACT_AMBIGUITY_AUDIT_STATE,
    contactAmbiguityRecovery:
      process.env.ROS_RECEIPT_CONTACT_AMBIGUITY_RECOVERY,
    contactAmbiguityRecoveryOutboxState:
      process.env.ROS_RECEIPT_CONTACT_AMBIGUITY_RECOVERY_OUTBOX_STATE,
    contactAmbiguityRecoveryOutboxHashBefore:
      process.env.ROS_RECEIPT_CONTACT_AMBIGUITY_RECOVERY_OUTBOX_HASH_BEFORE,
    contactAmbiguityRecoveryOutboxHashAfter:
      process.env.ROS_RECEIPT_CONTACT_AMBIGUITY_RECOVERY_OUTBOX_HASH_AFTER,
    contactAmbiguityHumanSafetyState:
      process.env.ROS_RECEIPT_CONTACT_AMBIGUITY_HUMAN_SAFETY_STATE,
    contactAmbiguityHumanSafetyOutboxHash:
      process.env.ROS_RECEIPT_CONTACT_AMBIGUITY_HUMAN_SAFETY_OUTBOX_HASH,
    cognitiveClosureDrift:
      process.env.ROS_RECEIPT_COGNITIVE_CLOSURE_DRIFT,
    cognitiveClosureWriteSet:
      process.env.ROS_RECEIPT_COGNITIVE_CLOSURE_WRITE_SET,
    cognitiveClosureAuthorizationHistory:
      process.env.ROS_RECEIPT_COGNITIVE_CLOSURE_AUTHORIZATION_HISTORY,
    cognitiveClosureRecoveryRestartVerified: true,
    cognitiveClosureStateBeforeRestart:
      process.env.ROS_RECEIPT_COGNITIVE_CLOSURE_STATE_BEFORE_RESTART,
    cognitiveClosureStateAfterRestart:
      process.env.ROS_RECEIPT_COGNITIVE_CLOSURE_STATE_AFTER_RESTART,
    closureAuthorizationJournalMutation:
      process.env.ROS_RECEIPT_CLOSURE_AUTHORIZATION_JOURNAL_MUTATION,
    closureAuthorizationJournalStateBeforeRestart:
      process.env.ROS_RECEIPT_CLOSURE_AUTHORIZATION_JOURNAL_STATE_BEFORE_RESTART,
    closureAuthorizationJournalStateAfterRestart:
      process.env.ROS_RECEIPT_CLOSURE_AUTHORIZATION_JOURNAL_STATE_AFTER_RESTART,
    cognitiveClosurePostRestartRetry:
      process.env.ROS_RECEIPT_COGNITIVE_CLOSURE_RECOVERY_RETRY,
    cognitiveClosurePostRestartWriteSet:
      process.env.ROS_RECEIPT_COGNITIVE_CLOSURE_RECOVERY_WRITE_SET,
    cognitiveClosurePostRestartAuthorizationHistory:
      process.env.ROS_RECEIPT_COGNITIVE_CLOSURE_RECOVERY_AUTHORIZATION_HISTORY,
    closureAuthorizationReadAfterRestartVerified: true,
    closureAuthorizationReadExact:
      process.env.ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_EXACT,
    closureAuthorizationReadMissingJournal:
      process.env.ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_MISSING,
    closureAuthorizationReadMismatch:
      process.env.ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_MISMATCH,
    closureAuthorizationReadRollbackRestored:
      process.env.ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_ROLLBACK,
    closureAuthorizationReadWriteSet:
      process.env.ROS_RECEIPT_CLOSURE_AUTHORIZATION_READ_WRITE_SET,
    closureReauthorizationRecoveryVerified: true,
    closureReauthorizationStaleRollback:
      process.env.ROS_RECEIPT_CLOSURE_REAUTHORIZATION_STALE_ROLLBACK,
    closureReauthorizationRefresh:
      process.env.ROS_RECEIPT_CLOSURE_REAUTHORIZATION_REFRESH,
    closureReauthorizationReplacement:
      process.env.ROS_RECEIPT_CLOSURE_REAUTHORIZATION_REPLACEMENT,
    closureReauthorizationHistory:
      process.env.ROS_RECEIPT_CLOSURE_REAUTHORIZATION_HISTORY,
    closureReauthorizationCurrentVersion:
      process.env.ROS_RECEIPT_CLOSURE_REAUTHORIZATION_CURRENT_VERSION,
    result: "PASS",
    externalArchiveReceipt: null,
  };
  process.stdout.write(`ROS_POSTGRES_BRAIN_JOURNEY_RECEIPT=${JSON.stringify(receipt)}\n`);
'
