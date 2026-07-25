#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must be set}"
: "${BACKUP_FILE:?BACKUP_FILE must be set}"
sha256sum -c "$BACKUP_FILE.sha256"
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-privileges "$BACKUP_FILE"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('public.road_events') IS NOT NULL" | grep -qx t
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('public.audit_logs') IS NOT NULL" | grep -qx t
echo "PostgreSQL restore verification passed"
