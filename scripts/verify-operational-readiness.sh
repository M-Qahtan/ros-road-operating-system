#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_SHA:=local}"
: "${CANDIDATE_HEAD_SHA:=$GITHUB_SHA}"
: "${CANDIDATE_BASE_SHA:=$GITHUB_SHA}"
: "${TESTED_MERGE_SHA:=$GITHUB_SHA}"
: "${READINESS_OUTPUT:=artifacts/reliability/operational-readiness.json}"

required_results=(
  "VERIFY_RESULT"
  "POSTGRES_RESULT"
  "STAGING_RESULT"
  "RIYADH_RESULT"
  "SECURITY_RESULT"
  "FAILURE_MODE_RESULT"
)

for variable in "${required_results[@]}"; do
  value="${!variable:-missing}"
  if [[ "$value" != "success" ]]; then
    echo "release gate ${variable}=${value}; expected success" >&2
    exit 1
  fi
done

required_files=(
  "docs/09-reliability/safety-and-traffic-slos.md"
  "docs/09-reliability/operational-readiness-and-release-gates.md"
  "docs/09-reliability/incident-management.md"
  "docs/09-reliability/observability-data-policy.md"
  "docs/09-reliability/recovery-drill.md"
  "scripts/postgres-restore-verify.sh"
  "scripts/run-safe-fault-injection.sh"
  "docs/08-pilot-riyadh/pilot-e2e-readiness.md"
  "docs/08-pilot-riyadh/failure-mode-traceability.md"
  ".github/workflows/security.yml"
)

for file in "${required_files[@]}"; do
  [[ -s "$file" ]] || { echo "missing readiness contract: $file" >&2; exit 1; }
done

# Non-negotiable release and human-authority statements must remain explicit.
grep -q "S3/S4 RoadEvents cannot close" docs/09-reliability/safety-and-traffic-slos.md
grep -q "Restore/readiness failure blocks release" docs/09-reliability/safety-and-traffic-slos.md
grep -q "Error budgets apply only to traffic-efficiency" docs/09-reliability/safety-and-traffic-slos.md
grep -q "medical diagnosis" docs/09-reliability/operational-readiness-and-release-gates.md
grep -q "legal fault" docs/09-reliability/operational-readiness-and-release-gates.md
grep -q "real government dispatch" docs/09-reliability/operational-readiness-and-release-gates.md
grep -q "P0" docs/09-reliability/incident-management.md
grep -q "precise location" docs/09-reliability/observability-data-policy.md

mkdir -p "$(dirname "$READINESS_OUTPUT")"
cat > "$READINESS_OUTPUT" <<JSON
{
  "candidateHeadSha": "$CANDIDATE_HEAD_SHA",
  "candidateBaseSha": "$CANDIDATE_BASE_SHA",
  "testedMergeSha": "$TESTED_MERGE_SHA",
  "status": "passed",
  "releaseBlocking": true,
  "upstream": {
    "verify": "$VERIFY_RESULT",
    "postgresRestore": "$POSTGRES_RESULT",
    "stagingFaultInjection": "$STAGING_RESULT",
    "riyadhE2E": "$RIYADH_RESULT",
    "security": "$SECURITY_RESULT",
    "failureModeSafety": "$FAILURE_MODE_RESULT"
  },
  "checks": {
    "sloSpecification": true,
    "safetyInvariants": true,
    "errorBudgetSeparation": true,
    "incidentManagement": true,
    "observabilityDataBoundary": true,
    "restoreGate": true,
    "faultInjectionContract": true,
    "humanAuthorityBoundary": true
  }
}
JSON

node --input-type=module <<'NODE'
import fs from 'node:fs';
const path = process.env.READINESS_OUTPUT ?? 'artifacts/reliability/operational-readiness.json';
const result = JSON.parse(fs.readFileSync(path, 'utf8'));
if (result.status !== 'passed' || result.releaseBlocking !== true) throw new Error('invalid readiness decision');
if (result.candidateHeadSha !== process.env.CANDIDATE_HEAD_SHA) throw new Error('candidate head SHA mismatch');
if (result.candidateBaseSha !== process.env.CANDIDATE_BASE_SHA) throw new Error('candidate base SHA mismatch');
if (result.testedMergeSha !== process.env.TESTED_MERGE_SHA) throw new Error('tested merge SHA mismatch');
if (Object.values(result.upstream).some((value) => value !== 'success')) throw new Error('non-success upstream result');
NODE

echo "Operational readiness gate passed for ${TESTED_MERGE_SHA}"
