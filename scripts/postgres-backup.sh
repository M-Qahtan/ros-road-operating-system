#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
backup_dir="${BACKUP_DIR:-backups/postgres}"
mkdir -p "$backup_dir"
file="$backup_dir/ros-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$file"
sha256sum "$file" > "$file.sha256"
echo "$file"
