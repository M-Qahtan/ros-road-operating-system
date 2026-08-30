#!/usr/bin/env bash
set -euo pipefail

: "${COMPOSE_FILE:=infrastructure/docker/docker-compose.yml}"
: "${FAULT_OUTPUT:=artifacts/reliability/fault-injection.json}"
: "${GITHUB_SHA:=local}"
: "${CANDIDATE_HEAD_SHA:=$GITHUB_SHA}"
: "${CANDIDATE_BASE_SHA:=$GITHUB_SHA}"
: "${TESTED_MERGE_SHA:=$GITHUB_SHA}"

mkdir -p "$(dirname "$FAULT_OUTPUT")"

result="failed"
redis_outage=false
redis_readiness_failed_closed=false
redis_recovery=false
postgres_outage=false
postgres_worker_fail_stop=false
postgres_recovery=false
object_storage_outage=false
object_storage_readiness_failed_closed=false
object_storage_recovery=false
api_liveness_preserved=false

write_evidence() {
  cat > "$FAULT_OUTPUT" <<JSON
{
  "candidateHeadSha": "$CANDIDATE_HEAD_SHA",
  "candidateBaseSha": "$CANDIDATE_BASE_SHA",
  "testedMergeSha": "$TESTED_MERGE_SHA",
  "status": "$result",
  "safeDegradation": {
    "redisOutageExposed": $redis_outage,
    "redisReadinessFailedClosed": $redis_readiness_failed_closed,
    "redisRecoveryVerified": $redis_recovery,
    "postgresOutageExposed": $postgres_outage,
    "postgresWorkerFailStopObserved": $postgres_worker_fail_stop,
    "postgresRecoveryVerified": $postgres_recovery,
    "objectStorageOutageExposed": $object_storage_outage,
    "objectStorageReadinessFailedClosed": $object_storage_readiness_failed_closed,
    "objectStorageRecoveryVerified": $object_storage_recovery,
    "objectStorageGate": "Object Storage Integration",
    "apiLivenessPreserved": $api_liveness_preserved
  }
}
JSON
}

cleanup() {
  docker compose -f "$COMPOSE_FILE" start postgres redis minio >/dev/null 2>&1 || true
  write_evidence
}
trap cleanup EXIT

http_status() {
  local endpoint="$1"
  docker compose -f "$COMPOSE_FILE" exec -T api node -e "fetch('http://127.0.0.1:3000/${endpoint}',{signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))" 2>/dev/null | tail -1
}

wait_http_status() {
  local endpoint="$1"
  local expected="$2"
  for _ in $(seq 1 30); do
    status="$(http_status "$endpoint" || true)"
    [[ "$status" == "$expected" ]] && return 0
    sleep 1
  done
  echo "${endpoint} did not reach HTTP ${expected}" >&2
  return 1
}

wait_service_running() {
  local service="$1"
  local expected="$2"
  for _ in $(seq 1 30); do
    running="$(docker compose -f "$COMPOSE_FILE" ps --status running --services | grep -Fx "$service" || true)"
    if [[ "$expected" == "true" && "$running" == "$service" ]]; then return 0; fi
    if [[ "$expected" == "false" && -z "$running" ]]; then return 0; fi
    sleep 1
  done
  echo "service ${service} running=${expected} was not observed" >&2
  return 1
}

wait_service_healthy() {
  local service="$1"
  for _ in $(seq 1 30); do
    health="$(docker compose -f "$COMPOSE_FILE" ps --format json "$service" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const rows=s.trim().split(/\n+/).filter(Boolean).map(JSON.parse);console.log(rows[0]?.Health||'')}catch{console.log('')}})" || true)"
    [[ "$health" == "healthy" ]] && return 0
    sleep 1
  done
  echo "service ${service} did not become healthy" >&2
  return 1
}

container_restart_count() {
  local service="$1"
  local container_id
  container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$service")"
  [[ -n "$container_id" ]] || return 1
  docker inspect --format '{{.RestartCount}}' "$container_id"
}

wait_service_restarted() {
  local service="$1"
  local previous_count="$2"
  local restart_count
  for _ in $(seq 1 30); do
    restart_count="$(container_restart_count "$service" || true)"
    if [[ "$restart_count" =~ ^[0-9]+$ ]] && (( restart_count > previous_count )); then return 0; fi
    sleep 1
  done
  echo "service ${service} did not restart after required-worker failure" >&2
  return 1
}

# Baseline: active runtime dependencies and the isolated storage service are healthy.
wait_http_status health 200
wait_http_status ready 200
wait_service_healthy postgres
wait_service_healthy redis
wait_service_healthy minio

# Redis outage: liveness remains available, runtime readiness fails closed, then recovers.
docker compose -f "$COMPOSE_FILE" stop redis >/dev/null
wait_service_running redis false
redis_outage=true
wait_http_status health 200
wait_http_status ready 503
redis_readiness_failed_closed=true

docker compose -f "$COMPOSE_FILE" start redis >/dev/null
wait_service_healthy redis
wait_http_status ready 200
redis_recovery=true

# PostgreSQL loss makes required workers fail-stop the process. Compose models
# the service supervisor: the process must restart, stay non-ready while the
# database is unavailable, and recover only after PostgreSQL is healthy.
api_restart_before="$(container_restart_count api)"
docker compose -f "$COMPOSE_FILE" stop postgres >/dev/null
wait_service_running postgres false
postgres_outage=true
wait_service_restarted api "$api_restart_before"
postgres_worker_fail_stop=true

docker compose -f "$COMPOSE_FILE" start postgres >/dev/null
wait_service_healthy postgres
wait_service_healthy api
wait_http_status health 200
wait_http_status ready 200
postgres_recovery=true

# Object storage is an active Evidence runtime dependency. Its loss must leave
# liveness available while readiness fails closed, then recover explicitly.
docker compose -f "$COMPOSE_FILE" stop minio >/dev/null
wait_service_running minio false
object_storage_outage=true
wait_http_status health 200
wait_http_status ready 503
object_storage_readiness_failed_closed=true

docker compose -f "$COMPOSE_FILE" start minio >/dev/null
wait_service_healthy minio
wait_http_status ready 200
object_storage_recovery=true

wait_http_status health 200
api_liveness_preserved=true
result="passed"
write_evidence

echo "Safe fault-injection drill passed for ${TESTED_MERGE_SHA}"
