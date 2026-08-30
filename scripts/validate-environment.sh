#!/usr/bin/env bash
set -euo pipefail

required=(
  POSTGRES_USER
  POSTGRES_PASSWORD
  POSTGRES_DB
  DATABASE_URL
  REDIS_PASSWORD
  REDIS_URL
  MINIO_ROOT_USER
  MINIO_ROOT_PASSWORD
  ROS_OUTBOX_WORKER_ID
  ROS_CONTACT_WORKER_ID
  OIDC_ISSUER
  OIDC_JWKS_URL
  OIDC_AUDIENCE
  OIDC_ALLOWED_BINDINGS
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required variable: ${name}" >&2
    exit 1
  fi
done

for name in POSTGRES_PASSWORD REDIS_PASSWORD MINIO_ROOT_PASSWORD; do
  value="${!name}"
  if [[ ${#value} -lt 20 ]] || [[ "${value,,}" =~ (change-me|replace-with|password|secret) ]]; then
    echo "Unsafe secret value: ${name}" >&2
    exit 1
  fi
done

echo "Environment validation passed"
