#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Required local integration tool 'docker' is unavailable; no PostgreSQL journey was executed" >&2
  exit 127
fi

for required_command in git node sha256sum; do
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
    database/migrations/*.sql \
    database/seeds/*.sql \
    database/tests/*.sql \
    | sha256sum | cut -d ' ' -f 1
)"

readonly container_name="ros-brain-postgres-${$}"
readonly postgres_password="ros-local-integration-only"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm --detach \
  --name "$container_name" \
  --volume "$(pwd):/workspace:ro" \
  --env POSTGRES_DB=ros \
  --env POSTGRES_USER=ros \
  --env "POSTGRES_PASSWORD=${postgres_password}" \
  postgis/postgis:16-3.4 >/dev/null

pg_isready() {
  docker exec "$container_name" pg_isready "$@"
}

psql() {
  docker exec --interactive --workdir /workspace "$container_name" psql "$@"
}

export -f pg_isready psql
export container_name
export DATABASE_URL="postgresql://ros:${postgres_password}@127.0.0.1:5432/ros"
export ROS_POSTGRES_RESTART_CONTAINER="$container_name"
export ROS_POSTGRES_RESTART_BEFORE_TEST="0011_ros_brain_journey_reconnect.sql"
bash scripts/run-postgres-integration.sh

readonly image_id="$(docker inspect --format '{{.Image}}' "$container_name")"
readonly postgres_version="$(psql "$DATABASE_URL" -Atqc 'SHOW server_version')"
readonly postgis_version="$(psql "$DATABASE_URL" -Atqc 'SELECT postgis_lib_version()')"

if [[ ! "$candidate_sha" =~ ^[a-f0-9]{40}$ \
  || ! "$journey_manifest_sha256" =~ ^[a-f0-9]{64}$ \
  || ! "$image_id" =~ ^sha256:[a-f0-9]{64}$ \
  || -z "$postgres_version" \
  || -z "$postgis_version" ]]; then
  echo "PostgreSQL journey passed but its local receipt provenance is incomplete" >&2
  exit 2
fi

ROS_RECEIPT_CANDIDATE_SHA="$candidate_sha" \
ROS_RECEIPT_JOURNEY_MANIFEST_SHA256="$journey_manifest_sha256" \
ROS_RECEIPT_IMAGE_ID="$image_id" \
ROS_RECEIPT_POSTGRES_VERSION="$postgres_version" \
ROS_RECEIPT_POSTGIS_VERSION="$postgis_version" \
node -e '
  const receipt = {
    schemaVersion: "ros-brain.local-postgres-journey-receipt.v1",
    candidateSha: process.env.ROS_RECEIPT_CANDIDATE_SHA,
    journeyManifestSha256: process.env.ROS_RECEIPT_JOURNEY_MANIFEST_SHA256,
    containerImageId: process.env.ROS_RECEIPT_IMAGE_ID,
    postgresVersion: process.env.ROS_RECEIPT_POSTGRES_VERSION,
    postgisVersion: process.env.ROS_RECEIPT_POSTGIS_VERSION,
    result: "PASS",
    externalArchiveReceipt: null,
  };
  process.stdout.write(`ROS_POSTGRES_BRAIN_JOURNEY_RECEIPT=${JSON.stringify(receipt)}\n`);
'
