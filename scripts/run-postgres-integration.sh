#!/usr/bin/env bash
set -euo pipefail

for required_command in pg_isready psql; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required PostgreSQL client '$required_command' is unavailable; no integration test was executed" >&2
    exit 127
  fi
done

: "${DATABASE_URL:?DATABASE_URL must be set}"

restart_performed=false
if [[ -n "${ROS_POSTGRES_RESTART_BEFORE_TEST:-}" ]]; then
  : "${ROS_POSTGRES_RESTART_CONTAINER:?restart container must be set}"
  : "${ROS_POSTGRES_RESTART_PROOF_FILE:?restart proof file must be set}"
  if [[ ! "$ROS_POSTGRES_RESTART_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
    echo "PostgreSQL restart container name is invalid" >&2
    exit 2
  fi
  if [[ ! "$ROS_POSTGRES_RESTART_BEFORE_TEST" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.sql$ \
    || ! -f "database/tests/$ROS_POSTGRES_RESTART_BEFORE_TEST" ]]; then
    echo "Requested PostgreSQL restart checkpoint does not exist: ${ROS_POSTGRES_RESTART_BEFORE_TEST}" >&2
    exit 2
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required for the requested PostgreSQL restart proof" >&2
    exit 127
  fi
  if [[ ! -f "$ROS_POSTGRES_RESTART_PROOF_FILE" \
    || -L "$ROS_POSTGRES_RESTART_PROOF_FILE" \
    || -s "$ROS_POSTGRES_RESTART_PROOF_FILE" ]]; then
    echo "PostgreSQL restart proof target must be a new empty regular file" >&2
    exit 2
  fi
fi

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

wait_for_postgres "before integration"

for migration in database/migrations/*.sql; do
  echo "Applying ${migration}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seeds/0001_local_road_events.sql

for test_file in database/tests/*.sql; do
  if [[ -n "${ROS_POSTGRES_RESTART_BEFORE_TEST:-}" \
    && "$(basename "$test_file")" == "$ROS_POSTGRES_RESTART_BEFORE_TEST" ]]; then
    restart_identity_before="$(
      psql "$DATABASE_URL" -Atqc \
        "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
    )"
    echo "Restarting PostgreSQL before ${test_file}"
    docker restart -- "$ROS_POSTGRES_RESTART_CONTAINER" >/dev/null
    wait_for_postgres "after restart"
    restart_identity_after="$(
      psql "$DATABASE_URL" -Atqc \
        "SELECT system_identifier::text || '|' || pg_postmaster_start_time()::text FROM pg_control_system()"
    )"
    before_system_identifier="${restart_identity_before%%|*}"
    after_system_identifier="${restart_identity_after%%|*}"
    before_postmaster_started_at="${restart_identity_before#*|}"
    after_postmaster_started_at="${restart_identity_after#*|}"
    if [[ -z "$before_system_identifier" \
      || -z "$after_system_identifier" \
      || "$before_system_identifier" != "$after_system_identifier" \
      || -z "$before_postmaster_started_at" \
      || -z "$after_postmaster_started_at" \
      || "$before_postmaster_started_at" == "$after_postmaster_started_at" ]]; then
      echo "PostgreSQL restart did not preserve the cluster and replace the postmaster" >&2
      exit 2
    fi
    restart_performed=true
  fi
  echo "Running ${test_file}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$test_file"
done

if [[ -n "${ROS_POSTGRES_RESTART_BEFORE_TEST:-}" && "$restart_performed" != true ]]; then
  echo "Requested PostgreSQL restart checkpoint was not reached: ${ROS_POSTGRES_RESTART_BEFORE_TEST}" >&2
  exit 2
fi

if [[ "$restart_performed" == true ]]; then
  printf '%s\n' \
    "$before_system_identifier" \
    "$before_postmaster_started_at" \
    "$after_system_identifier" \
    "$after_postmaster_started_at" \
    > "$ROS_POSTGRES_RESTART_PROOF_FILE"
fi

if [[ -n "${ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE:-}" ]]; then
  bash scripts/run-postgres-closure-race.sh
fi

echo "PostgreSQL/PostGIS integration checks passed"
