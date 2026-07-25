#!/usr/bin/env bash
set -euo pipefail
: "${MINIO_ALIAS:?MINIO_ALIAS must be configured by mc alias set}"
: "${OBJECT_STORAGE_BUCKET:?OBJECT_STORAGE_BUCKET must be set}"
mode="${1:-}"
backup_dir="${BACKUP_DIR:-backups/minio}"
mkdir -p "$backup_dir"
case "$mode" in
  backup)
    mc mirror --overwrite "$MINIO_ALIAS/$OBJECT_STORAGE_BUCKET" "$backup_dir/$OBJECT_STORAGE_BUCKET"
    find "$backup_dir/$OBJECT_STORAGE_BUCKET" -type f -print0 | sort -z | xargs -0 sha256sum > "$backup_dir/manifest.sha256"
    ;;
  restore)
    (cd "$backup_dir" && sha256sum -c manifest.sha256)
    mc mb --ignore-existing "$MINIO_ALIAS/$OBJECT_STORAGE_BUCKET"
    mc mirror --overwrite "$backup_dir/$OBJECT_STORAGE_BUCKET" "$MINIO_ALIAS/$OBJECT_STORAGE_BUCKET"
    local_count=$(find "$backup_dir/$OBJECT_STORAGE_BUCKET" -type f | wc -l | tr -d ' ')
    remote_count=$(mc find "$MINIO_ALIAS/$OBJECT_STORAGE_BUCKET" --type f | wc -l | tr -d ' ')
    [[ "$local_count" == "$remote_count" ]]
    ;;
  *) echo "usage: $0 backup|restore" >&2; exit 2 ;;
esac
echo "MinIO ${mode} verification passed"
