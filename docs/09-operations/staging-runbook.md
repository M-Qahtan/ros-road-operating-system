# ROS staging operations runbook

## Fresh start

1. Copy `.env.example` to `.env` and replace every placeholder with generated secrets.
2. Run `set -a; source .env; set +a; bash scripts/validate-environment.sh`.
3. Run `docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up -d --build`.
4. Run `DATABASE_URL="$DATABASE_URL" bash scripts/migration-smoke.sh`.
5. Verify `GET /health` returns 200 and `GET /ready` returns 200. Liveness must not be used as readiness.

## Deployment

- Build an immutable image tagged with the commit SHA.
- Validate environment and migrations before routing traffic.
- Deploy one instance, verify readiness and structured logs, then continue rollout.
- Never place secrets in images, compose files, logs, pull requests or shell history.

## Rollback

- Stop traffic to the new revision, deploy the previous image SHA, and verify `/ready`.
- Database migrations are forward-only. Do not rewrite applied migration files.
- If a migration causes unsafe behavior, disable writes and apply a reviewed corrective migration.

## PostgreSQL backup and restore drill

- Backup: `DATABASE_URL=... bash scripts/postgres-backup.sh`.
- Restore only into a clean verification database: `RESTORE_DATABASE_URL=... BACKUP_FILE=... bash scripts/postgres-restore-verify.sh`.
- Record checksum, backup timestamp, source revision, restore duration and verification result.

## MinIO backup and restore drill

Configure the MinIO client alias outside source control, then run:

- `MINIO_ALIAS=staging OBJECT_STORAGE_BUCKET=ros-evidence bash scripts/minio-backup-restore.sh backup`
- Restore into a clean bucket/account and run the same command with `restore`.

The script verifies local checksums and object counts. Production evidence retention and legal holds override ordinary deletion procedures.

## Incident response

1. Declare severity and incident commander.
2. Preserve trace IDs, affected RoadEvent IDs, deployment SHA and dependency state.
3. If audit, database, timers or evidence integrity are unavailable, change readiness to NO_GO and block critical writes.
4. Restore service using the last known-good revision or verified backup.
5. Document timeline, decisions, data impact and corrective actions.
