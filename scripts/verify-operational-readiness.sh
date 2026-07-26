#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_SHA:=local}"
: "${READINESS_OUTPUT:=artifacts/reliability/operational-readiness.json}"

required_files=(
  "docs/09-reliability/safety-and-traffic-slos.md"
  "docs/09-reliability/operational-readiness-and-release-gates.md"
  "docs/09-reliability/incident-management.md"
  "scripts/postgres-restore-verify.sh"
  "scripts/run-safe-fault-injection.sh"
  "docs/08-pilot-riyadh/pilot-e2e-readiness.md"
)

for file in "${required_files[@]}"; do
  [[ -s "$file" ]] || { echo "missing readiness evidence: $file" >&2; exit 1; }
done

# Safety invariants and release-blocking statements must remain explicit.
grep -q "S3/S4 RoadEvents cannot close" docs/09-reliability/safety-and-traffic-slos.md
grep -q "Restore/readiness failure blocks release" docs/09-reliability/safety-and-traffic-slos.md
grep -q "Error budgets apply only to traffic-efficiency" docs/09-reliability/safety-and-traffic-slos.md
grep -q "restore verification fails" docs/09-reliability/operational-readiness-and-release-gates.md
grep -q "P0" docs/09-reliability/incident-management.md

mkdir -p "$(dirname "$READINESS_OUTPUT")"
cat > "$READINESS_OUTPUT" <<JSON
{
  "commitSha": "$GITHUB_SHA",
  "status": "passed",
  "releaseBlocking": true,
  "checks": {
    "sloSpecification": true,
    "safetyInvariants": true,
    "errorBudgetSeparation": true,
    "incidentManagement": true,
    "restoreGate": true,
    "faultInjectionContract": true
  }
}
JSON

echo "Operational readiness gate passed for $GITHUB_SHA"
