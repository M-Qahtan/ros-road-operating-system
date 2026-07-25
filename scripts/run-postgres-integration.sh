#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"

for attempt in $(seq 1 30); do
  if pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "30" ]]; then
    echo "PostgreSQL did not become ready" >&2
    exit 1
  fi
  sleep 2
done

for migration in database/migrations/*.sql; do
  echo "Applying ${migration}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seeds/0001_local_road_events.sql

for test_file in database/tests/*.sql; do
  echo "Running ${test_file}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$test_file"
done

echo "PostgreSQL/PostGIS integration checks passed"
