#!/usr/bin/env bash
set -euo pipefail

: "${COMPOSE_FILE:=infrastructure/docker/docker-compose.yml}"
: "${FAULT_OUTPUT:=artifacts/reliability/fault-injection.json}"
: "${GITHUB_SHA:=local}"

mkdir -p "$(dirname "$FAULT_OUTPUT")"

result="failed"
redis_outage=false
redis_recovery=false
object_storage_outage=false
object_storage_recovery=false
api_liveness_preserved=false

write_evidence() {
  cat > "$FAULT_OUTPUT" <<JSON
{
  "commitSha": "$GITHUB_SHA",
  "status": "$result",
  "safeDegradation": {
    "redisOutageExposed": $redis_outage,
    "redisRecoveryVerified": $redis_recovery,
    "objectStorageOutageExposed": $object_storage_outage,
    "objectStorageRecoveryVerified": $object_storage_recovery,
    "apiLivenessPreserved": $api_liveness_preserved
  }
}
JSON
}

cleanup() {
  docker compose -f "$COMPOSE_FILE" start redis minio >/dev/null 2>&1 || true
  write_evidence
}
trap cleanup EXIT

wait_http_status() {
  local endpoint="$1"
  local expected="$2"
  for _ in $(seq 1 30); do
    status=$(docker compose -f "$COMPOSE_FILE" exec -T api node -e "fetch('http://127.0.0.1:3000/${endpoint}',{signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))" 2>/dev/null | tail -1 || true)
    [[ "$status" == "$expected" ]] && return 0
    sleep 1
  done
  return 1
}

wait_service_running() {
  local service="$1"
  local expected="$2"
  for _ in $(seq 1 30); do
    running=$(docker compose -f "$COMPOSE_FILE" ps --status running --services | grep -Fx "$service" || true)
    if [[ "$expected" == "true" && "$running" == "$service" ]]; then return 0; fi
    if [[ "$expected" == "false" && -z "$running" ]]; then return 0; fi
    sleep 1
  done
  return 1
}

wait_service_healthy() {
  local service="$1"
  for _ in $(seq 1 30); do
    health=$(docker compose -f "$COMPOSE_FILE" ps --format json "$service" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const rows=s.trim().split(/\n+/).filter(Boolean).map(JSON.parse);console.log(rows[0]?.Health||'')}catch{console.log('')}})" || true)
    [[ "$health" == "healthy" ]] && return 0
    sleep 1
  done
  return 1
}

# Baseline: the platform and API are healthy before fault injection.
wait_http_status ready 200
wait_service_healthy redis
wait_service_healthy minio

# Redis outage must be observable at the infrastructure boundary and recover cleanly.
docker compose -f "$COMPOSE_FILE" stop redis >/dev/null
wait_service_running redis false
redis_outage=true
wait_http_status health 200

docker compose -f "$COMPOSE_FILE" start redis >/dev/null
wait_service_healthy redis
redis_recovery=true

# Object storage outage must be observable and recover cleanly.
docker compose -f "$COMPOSE_FILE" stop minio >/dev/null
wait_service_running minio false
object_storage_outage=true
wait_http_status health 200

docker compose -f "$COMPOSE_FILE" start minio >/dev/null
wait_service_healthy minio
object_storage_recovery=true

# Liveness remains distinct from dependency readiness during controlled faults.
wait_http_status health 200
api_liveness_preserved=true
result="passed"
write_evidence

echo "Safe fault-injection drill passed for $GITHUB_SHA"