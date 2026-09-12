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

for required_command in git mktemp node sha256sum; do
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
    database/migrations/*.sql \
    database/seeds/*.sql \
    database/tests/*.sql \
    | sha256sum | cut -d ' ' -f 1
)"

readonly container_name="ros-brain-postgres-${$}"
readonly postgres_password="ros-local-integration-only"
readonly restart_proof_file="$(mktemp)"
readonly closure_race_proof_file="$(mktemp)"

cleanup() {
  "$container_engine" rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f "$restart_proof_file"
  rm -f "$closure_race_proof_file"
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
  "$container_engine" exec "$container_name" pg_isready "$@"
}

psql() {
  "$container_engine" exec --interactive --workdir /workspace "$container_name" psql "$@"
}

export -f pg_isready psql
export container_name
export DATABASE_URL="postgresql://ros:${postgres_password}@127.0.0.1:5432/ros"
export ROS_POSTGRES_CONTAINER_ENGINE="$container_engine"
export ROS_POSTGRES_RESTART_CONTAINER="$container_name"
export ROS_POSTGRES_RESTART_BEFORE_TEST="0011_ros_brain_journey_reconnect.sql"
export ROS_POSTGRES_RESTART_PROOF_FILE="$restart_proof_file"
export ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE="$closure_race_proof_file"
bash scripts/run-postgres-integration.sh

mapfile -t restart_proof < "$restart_proof_file"
if [[ "${#restart_proof[@]}" -ne 4 ]]; then
  echo "PostgreSQL journey passed without a complete restart identity proof" >&2
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
  || -z "$postmaster_started_at_before_restart" \
  || -z "$postmaster_started_at_after_restart" \
  || "$postmaster_started_at_before_restart" == "$postmaster_started_at_after_restart" \
  || "$postmaster_started_at_after_restart" != "$postmaster_started_at" ]]; then
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
node -e '
  const receipt = {
    schemaVersion: "ros-brain.local-postgres-journey-receipt.v6",
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
    result: "PASS",
    externalArchiveReceipt: null,
  };
  process.stdout.write(`ROS_POSTGRES_BRAIN_JOURNEY_RECEIPT=${JSON.stringify(receipt)}\n`);
'
