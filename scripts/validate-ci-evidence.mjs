import fs from 'node:fs';

const [manifestPath, expectedJob] = process.argv.slice(2);

function fail(message) {
  console.error(`CI evidence validation failed: ${message}`);
  process.exit(1);
}

if (!manifestPath || !expectedJob) {
  fail('usage: node scripts/validate-ci-evidence.mjs <manifest-path> <expected-job>');
}

if (!fs.existsSync(manifestPath)) {
  fail(`missing manifest: ${manifestPath}`);
}

const raw = fs.readFileSync(manifestPath, 'utf8');
if (raw.trim().length === 0) {
  fail(`empty manifest: ${manifestPath}`);
}

let manifest;
try {
  manifest = JSON.parse(raw);
} catch (error) {
  fail(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const requiredKeys = [
  'schema',
  'job',
  'repository',
  'workflow',
  'event',
  'ref',
  'candidate_head_sha',
  'candidate_base_sha',
  'tested_merge_sha',
  'run_id',
  'run_attempt'
];

const actualKeys = Object.keys(manifest).sort();
const expectedKeys = [...requiredKeys].sort();
if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
  fail(`unexpected manifest keys: ${actualKeys.join(', ')}`);
}

for (const key of requiredKeys) {
  if (typeof manifest[key] !== 'string' || manifest[key].length === 0) {
    fail(`${key} must be a non-empty string`);
  }
}

const shaPattern = /^[0-9a-f]{40}$/;
for (const key of ['candidate_head_sha', 'candidate_base_sha', 'tested_merge_sha']) {
  if (!shaPattern.test(manifest[key])) {
    fail(`${key} must be a lowercase 40-character commit SHA`);
  }
}

if (!/^[0-9]+$/.test(manifest.run_id) || !/^[0-9]+$/.test(manifest.run_attempt)) {
  fail('run_id and run_attempt must be decimal strings');
}

const expected = {
  schema: process.env.CI_EVIDENCE_SCHEMA,
  job: expectedJob,
  repository: process.env.GITHUB_REPOSITORY,
  workflow: process.env.GITHUB_WORKFLOW,
  event: process.env.GITHUB_EVENT_NAME,
  ref: process.env.GITHUB_REF,
  candidate_head_sha: process.env.CANDIDATE_HEAD_SHA,
  candidate_base_sha: process.env.CANDIDATE_BASE_SHA,
  tested_merge_sha: process.env.TESTED_MERGE_SHA,
  run_id: process.env.GITHUB_RUN_ID,
  run_attempt: process.env.GITHUB_RUN_ATTEMPT
};

for (const [key, expectedValue] of Object.entries(expected)) {
  if (typeof expectedValue !== 'string' || expectedValue.length === 0) {
    fail(`validator environment is missing ${key}`);
  }
  if (manifest[key] !== expectedValue) {
    fail(`${key} mismatch: expected ${expectedValue}, received ${manifest[key]}`);
  }
}

console.log(`Validated ${manifestPath} for ${expectedJob} at ${manifest.tested_merge_sha}`);
