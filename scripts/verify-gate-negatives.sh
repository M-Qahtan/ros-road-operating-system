#!/usr/bin/env bash
set -euo pipefail

gate_tmp="$(mktemp -d /tmp/ros-gate-negative-XXXXXX)"
trap 'rm -rf "$gate_tmp"' EXIT

sha_a="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
sha_b="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

node --input-type=module - "$gate_tmp/stale.json" "$sha_a" "$sha_b" <<'NODE'
import fs from 'node:fs';
const [path, expected, stale] = process.argv.slice(2);
fs.writeFileSync(path, JSON.stringify({
  schema: 'ros-ci-evidence/v3', job: 'verify', repository: 'M-Qahtan/ros-road-operating-system',
  workflow: 'negative-proof', event: 'pull_request', ref: 'refs/pull/1/merge',
  candidate_head_sha: expected, candidate_base_sha: expected, tested_merge_sha: stale,
  run_id: '1', run_attempt: '1', retention_days: '365'
}));
NODE

if CI_EVIDENCE_SCHEMA=ros-ci-evidence/v3 CI_EVIDENCE_RETENTION_DAYS=365 \
  GITHUB_REPOSITORY=M-Qahtan/ros-road-operating-system GITHUB_WORKFLOW=negative-proof \
  GITHUB_EVENT_NAME=pull_request GITHUB_REF=refs/pull/1/merge \
  CANDIDATE_HEAD_SHA="$sha_a" CANDIDATE_BASE_SHA="$sha_a" TESTED_MERGE_SHA="$sha_a" \
  GITHUB_RUN_ID=1 GITHUB_RUN_ATTEMPT=1 \
  node scripts/validate-ci-evidence.mjs "$gate_tmp/stale.json" verify >/dev/null 2>&1; then
  echo "stale tested merge SHA was accepted" >&2
  exit 1
fi

if VERIFY_RESULT=success POSTGRES_RESULT=success STAGING_RESULT=skipped RIYADH_RESULT=success \
  SECURITY_RESULT=success FAILURE_MODE_RESULT=success \
  CANDIDATE_HEAD_SHA="$sha_a" CANDIDATE_BASE_SHA="$sha_a" TESTED_MERGE_SHA="$sha_a" \
  READINESS_OUTPUT="$gate_tmp/readiness.json" \
  bash scripts/verify-operational-readiness.sh >/dev/null 2>&1; then
  echo "skipped upstream result was accepted" >&2
  exit 1
fi

echo "Negative evidence gates passed (stale SHA and skipped upstream both rejected)."
