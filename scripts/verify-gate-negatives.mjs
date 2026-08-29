import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ros-gate-negative-'));
const shaA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const shaB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function run(script, args, environment) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe'
  });
}

try {
  const stalePath = join(temporaryDirectory, 'stale.json');
  await writeFile(stalePath, JSON.stringify({
    schema: 'ros-ci-evidence/v3',
    job: 'verify',
    repository: 'M-Qahtan/ros-road-operating-system',
    workflow: 'negative-proof',
    event: 'pull_request',
    ref: 'refs/pull/1/merge',
    candidate_head_sha: shaA,
    candidate_base_sha: shaA,
    tested_merge_sha: shaB,
    run_id: '1',
    run_attempt: '1',
    retention_days: '365'
  }), 'utf8');

  const evidenceEnvironment = {
    CI_EVIDENCE_SCHEMA: 'ros-ci-evidence/v3',
    CI_EVIDENCE_RETENTION_DAYS: '365',
    GITHUB_REPOSITORY: 'M-Qahtan/ros-road-operating-system',
    GITHUB_WORKFLOW: 'negative-proof',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF: 'refs/pull/1/merge',
    CANDIDATE_HEAD_SHA: shaA,
    CANDIDATE_BASE_SHA: shaA,
    TESTED_MERGE_SHA: shaA,
    GITHUB_RUN_ID: '1',
    GITHUB_RUN_ATTEMPT: '1'
  };
  if (run('scripts/validate-ci-evidence.mjs', [stalePath, 'verify'], evidenceEnvironment).status === 0) {
    throw new Error('stale tested merge SHA was accepted');
  }

  const readinessEnvironment = {
    VERIFY_RESULT: 'success',
    POSTGRES_RESULT: 'success',
    STAGING_RESULT: 'skipped',
    RIYADH_RESULT: 'success',
    SECURITY_RESULT: 'success',
    FAILURE_MODE_RESULT: 'success',
    CANDIDATE_HEAD_SHA: shaA,
    CANDIDATE_BASE_SHA: shaA,
    TESTED_MERGE_SHA: shaA,
    READINESS_OUTPUT: join(temporaryDirectory, 'readiness.json')
  };
  if (run('scripts/verify-operational-readiness.mjs', [], readinessEnvironment).status === 0) {
    throw new Error('skipped upstream result was accepted');
  }

  console.log('Negative evidence gates passed (stale SHA and skipped upstream both rejected).');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
