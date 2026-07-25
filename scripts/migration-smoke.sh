#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
for migration in database/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT postgis_version(); SELECT count(*) FROM schema_migrations;" >/dev/null || true
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('public.road_events') IS NOT NULL" | grep -qx t
echo "Migration smoke test passed"
