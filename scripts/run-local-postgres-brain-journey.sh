#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Required local integration tool 'docker' is unavailable; no PostgreSQL journey was executed" >&2
  exit 127
fi

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
