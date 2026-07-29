import { mkdir, writeFile } from 'node:fs/promises';
import { runRiyadhFailureModeSuite } from './riyadh-failure-modes.js';

const testedMergeSha = process.env.TESTED_MERGE_SHA ?? process.env.GITHUB_SHA ?? 'local';
const candidateHeadSha = process.env.CANDIDATE_HEAD_SHA ?? testedMergeSha;
const candidateBaseSha = process.env.CANDIDATE_BASE_SHA ?? testedMergeSha;
const results = runRiyadhFailureModeSuite(testedMergeSha);
const payload = JSON.stringify({
  suite: 'riyadh-failure-mode-safety',
  candidateHeadSha,
  candidateBaseSha,
  testedMergeSha,
  passed: true,
  hazards: results
}, null, 2);

await mkdir('artifacts/riyadh-failure-modes', { recursive: true });
await writeFile('artifacts/riyadh-failure-modes/result.json', `${payload}\n`, 'utf8');
console.log(payload);
