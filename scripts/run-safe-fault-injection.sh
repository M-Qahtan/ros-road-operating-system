#!/usr/bin/env bash
set -euo pipefail

: "${COMPOSE_FILE:=infrastructure/docker/docker-compose.yml}"
: "${FAULT_OUTPUT:=artifacts/reliability/fault-injection.json}"
: "${GITHUB_SHA:=local}"
: "${CANDIDATE_HEAD_SHA:=$GITHUB_SHA}"
: "${CANDIDATE_BASE_SHA:=$GITHUB_SHA}"
: "${TESTED_MERGE_SHA:=$GITHUB_SHA}"
: "${REDIS_FAULT_HOLD_SECONDS:=20}"

if ! [[ "$REDIS_FAULT_HOLD_SECONDS" =~ ^[0-9]+$ ]] ||
   (( REDIS_FAULT_HOLD_SECONDS < 4 || REDIS_FAULT_HOLD_SECONDS > 60 )); then
  echo "REDIS_FAULT_HOLD_SECONDS must be an integer between 4 and 60" >&2
  exit 1
fi

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
api_container_id_before_redis=""
api_container_id_during_redis=""
api_container_id_after_redis=""
api_restart_count_before_redis=null
api_restart_count_during_redis=null
api_restart_count_after_redis=null
api_container_identity_preserved=false
api_restart_count_preserved=false
redis_outage_body_status="not_observed"
redis_outage_body_check="not_observed"
redis_recovery_body_status="not_observed"
redis_recovery_body_check="not_observed"

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
    "redisOutageHoldSeconds": $REDIS_FAULT_HOLD_SECONDS,
    "redisReadinessBodyDuringOutage": {
      "status": "$redis_outage_body_status",
      "checks": { "redis": "$redis_outage_body_check" }
    },
    "redisReadinessBodyAfterRecovery": {
      "status": "$redis_recovery_body_status",
      "checks": { "redis": "$redis_recovery_body_check" }
    },
    "apiContinuityDuringRedisFault": {
      "containerIdBefore": "$api_container_id_before_redis",
      "containerIdDuring": "$api_container_id_during_redis",
      "containerIdAfter": "$api_container_id_after_redis",
      "restartCountBefore": $api_restart_count_before_redis,
      "restartCountDuring": $api_restart_count_during_redis,
      "restartCountAfter": $api_restart_count_after_redis,
      "containerIdentityPreserved": $api_container_identity_preserved,
      "restartCountPreserved": $api_restart_count_preserved
    },
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

readiness_contract_snapshot() {
  local expected_http="$1"
  local expected_status="$2"
  local expected_redis="$3"
  docker compose -f "$COMPOSE_FILE" exec -T api \
    node - "$expected_http" "$expected_status" "$expected_redis" <<'NODE'
const [expectedHttpText, expectedStatus, expectedRedis] = process.argv.slice(2);

(async () => {
  const response = await fetch('http://127.0.0.1:3000/ready', {
    signal: AbortSignal.timeout(2000)
  });
  const body = await response.json();
  if (response.status !== Number(expectedHttpText)) {
    throw new Error(`expected HTTP ${expectedHttpText}, observed ${response.status}`);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('readiness body must be a JSON object');
  }
  if (body.status !== expectedStatus) {
    throw new Error(`expected readiness status ${expectedStatus}, observed ${String(body.status)}`);
  }
  if (body.checks === null || typeof body.checks !== 'object' || Array.isArray(body.checks)) {
    throw new Error('readiness body must contain a checks object');
  }
  if (body.checks.redis !== expectedRedis) {
    throw new Error(`expected checks.redis ${expectedRedis}, observed ${String(body.checks.redis)}`);
  }
  process.stdout.write(`${body.status}\t${body.checks.redis}\n`);
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
NODE
}

wait_readiness_contract() {
  local expected_http="$1"
  local expected_status="$2"
  local expected_redis="$3"
  local snapshot
  for _ in $(seq 1 30); do
    if snapshot="$(readiness_contract_snapshot "$expected_http" "$expected_status" "$expected_redis" 2>/dev/null)"; then
      printf '%s\n' "$snapshot"
      return 0
    fi
    sleep 1
  done
  echo "ready did not reach HTTP ${expected_http}, status=${expected_status}, checks.redis=${expected_redis}" >&2
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

container_identity_snapshot() {
  local service="$1"
  local container_id
  local restart_count
  container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$service")"
  [[ -n "$container_id" ]] || return 1
  container_id="$(docker inspect --format '{{.Id}}' "$container_id")"
  restart_count="$(docker inspect --format '{{.RestartCount}}' "$container_id")"
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$restart_count" =~ ^[0-9]+$ ]] || return 1
  printf '%s %s\n' "$container_id" "$restart_count"
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
read -r api_container_id_before_redis api_restart_count_before_redis < <(container_identity_snapshot api)
docker compose -f "$COMPOSE_FILE" stop redis >/dev/null
wait_service_running redis false
redis_outage=true
wait_http_status health 200
wait_readiness_contract 503 not_ready unreachable >/dev/null
redis_readiness_failed_closed=true

# Hold the outage beyond the default reconnect budget so recovery exercises a
# fresh in-process connection rather than an already pending short reconnect.
sleep "$REDIS_FAULT_HOLD_SECONDS"
wait_http_status health 200
redis_outage_snapshot="$(wait_readiness_contract 503 not_ready unreachable)"
IFS=$'\t' read -r redis_outage_body_status redis_outage_body_check <<< "$redis_outage_snapshot"
read -r api_container_id_during_redis api_restart_count_during_redis < <(container_identity_snapshot api)

docker compose -f "$COMPOSE_FILE" start redis >/dev/null
wait_service_healthy redis
redis_recovery_snapshot="$(wait_readiness_contract 200 ready reachable)"
IFS=$'\t' read -r redis_recovery_body_status redis_recovery_body_check <<< "$redis_recovery_snapshot"
read -r api_container_id_after_redis api_restart_count_after_redis < <(container_identity_snapshot api)

if [[ "$api_container_id_before_redis" != "$api_container_id_during_redis" ||
      "$api_container_id_before_redis" != "$api_container_id_after_redis" ]]; then
  echo "API container identity changed during the Redis fault" >&2
  exit 1
fi
api_container_identity_preserved=true

if [[ "$api_restart_count_before_redis" != "$api_restart_count_during_redis" ||
      "$api_restart_count_before_redis" != "$api_restart_count_after_redis" ]]; then
  echo "API container restarted during the Redis fault" >&2
  exit 1
fi
api_restart_count_preserved=true
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
