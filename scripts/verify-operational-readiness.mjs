import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const environment = process.env;
const githubSha = environment.GITHUB_SHA ?? 'local';
const candidateHeadSha = environment.CANDIDATE_HEAD_SHA ?? githubSha;
const candidateBaseSha = environment.CANDIDATE_BASE_SHA ?? githubSha;
const testedMergeSha = environment.TESTED_MERGE_SHA ?? githubSha;
const output = environment.READINESS_OUTPUT ?? 'artifacts/reliability/operational-readiness.json';

const upstreamVariables = [
  'VERIFY_RESULT',
  'POSTGRES_RESULT',
  'STAGING_RESULT',
  'RIYADH_RESULT',
  'SECURITY_RESULT',
  'FAILURE_MODE_RESULT'
];

for (const variable of upstreamVariables) {
  const value = environment[variable] ?? 'missing';
  if (value !== 'success') throw new Error(`release gate ${variable}=${value}; expected success`);
}

const requiredFiles = [
  'docs/09-reliability/safety-and-traffic-slos.md',
  'docs/09-reliability/operational-readiness-and-release-gates.md',
  'docs/09-reliability/incident-management.md',
  'docs/09-reliability/observability-data-policy.md',
  'docs/09-reliability/recovery-drill.md',
  'scripts/postgres-restore-verify.sh',
  'scripts/run-safe-fault-injection.sh',
  'docs/08-pilot-riyadh/pilot-e2e-readiness.md',
  'docs/08-pilot-riyadh/failure-mode-traceability.md',
  '.github/workflows/security.yml'
];

await Promise.all(requiredFiles.map((path) => access(path)));

const phraseContracts = new Map([
  ['docs/09-reliability/safety-and-traffic-slos.md', [
    'S3/S4 RoadEvents cannot close',
    'Restore/readiness failure blocks release',
    'Error budgets apply only to traffic-efficiency'
  ]],
  ['docs/09-reliability/operational-readiness-and-release-gates.md', [
    'medical diagnosis',
    'legal fault',
    'real government dispatch'
  ]],
  ['docs/09-reliability/incident-management.md', ['P0']],
  ['docs/09-reliability/observability-data-policy.md', ['precise location']]
]);

for (const [path, phrases] of phraseContracts) {
  const content = await readFile(path, 'utf8');
  for (const phrase of phrases) {
    if (!content.includes(phrase)) throw new Error(`missing readiness statement '${phrase}' in ${path}`);
  }
}

const result = {
  candidateHeadSha,
  candidateBaseSha,
  testedMergeSha,
  status: 'passed',
  releaseBlocking: true,
  upstream: {
    verify: environment.VERIFY_RESULT,
    postgresRestore: environment.POSTGRES_RESULT,
    stagingFaultInjection: environment.STAGING_RESULT,
    riyadhE2E: environment.RIYADH_RESULT,
    security: environment.SECURITY_RESULT,
    failureModeSafety: environment.FAILURE_MODE_RESULT
  },
  checks: {
    sloSpecification: true,
    safetyInvariants: true,
    errorBudgetSeparation: true,
    incidentManagement: true,
    observabilityDataBoundary: true,
    restoreGate: true,
    faultInjectionContract: true,
    humanAuthorityBoundary: true
  }
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`Operational readiness gate passed for ${testedMergeSha}`);
