#!/usr/bin/env bash
set -euo pipefail

for required_command in docker pg_isready psql; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required local integration tool '$required_command' is unavailable; no PostgreSQL journey was executed" >&2
    exit 127
  fi
done

readonly container_name="ros-brain-postgres-${$}"
readonly postgres_port="${ROS_POSTGRES_PORT:-55432}"
readonly postgres_password="ros-local-integration-only"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm --detach \
  --name "$container_name" \
  --publish "127.0.0.1:${postgres_port}:5432" \
  --env POSTGRES_DB=ros \
  --env POSTGRES_USER=ros \
  --env "POSTGRES_PASSWORD=${postgres_password}" \
  postgis/postgis:16-3.4 >/dev/null

export DATABASE_URL="postgresql://ros:${postgres_password}@127.0.0.1:${postgres_port}/ros"
bash scripts/run-postgres-integration.sh
