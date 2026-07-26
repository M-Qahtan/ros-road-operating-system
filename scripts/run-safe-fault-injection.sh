#!/usr/bin/env bash
set -euo pipefail

: "${COMPOSE_FILE:=infrastructure/docker/docker-compose.yml}"
: "${FAULT_OUTPUT:=artifacts/reliability/fault-injection.json}"
: "${GITHUB_SHA:=local}"

mkdir -p "$(dirname "$FAULT_OUTPUT")"

cleanup() {
  docker compose -f "$COMPOSE_FILE" start redis minio >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_ready() {
  local expected="$1"
  for attempt in $(seq 1 20); do
    status=$(docker compose -f "$COMPOSE_FILE" exec -T api node -e "fetch('http://127.0.0.1:3000/ready',{signal:AbortSignal.timeout(2000)}).then(async r=>{console.log(r.status);process.exit(r.status===$expected?0:1)}).catch(()=>process.exit(1))" 2>/dev/null | tail -1 || true)
    [[ "$status" == "$expected" ]] && return 0
    sleep 1
  done
  return 1
}

# Baseline must be ready before injecting faults.
wait_ready 200

# Redis outage must be explicit and must not leave readiness falsely healthy.
docker compose -f "$COMPOSE_FILE" stop redis >/dev/null
wait_ready 503

docker compose -f "$COMPOSE_FILE" start redis >/dev/null
wait_ready 200

# Object storage outage must also be explicit and recoverable.
docker compose -f "$COMPOSE_FILE" stop minio >/dev/null
wait_ready 503

docker compose -f "$COMPOSE_FILE" start minio >/dev/null
wait_ready 200

cat > "$FAULT_OUTPUT" <<JSON
{
  "commitSha": "$GITHUB_SHA",
  "status": "passed",
  "safeDegradation": {
    "redisOutageExposed": true,
    "redisRecoveryVerified": true,
    "objectStorageOutageExposed": true,
    "objectStorageRecoveryVerified": true,
    "falseHealthyReadiness": false
  }
}
JSON

echo "Safe fault-injection drill passed for $GITHUB_SHA"
