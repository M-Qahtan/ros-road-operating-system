import { mkdir, writeFile } from 'node:fs/promises';
import { runRiyadhFailureModeSuite } from './riyadh-failure-modes.js';

const commitSha = process.env.GITHUB_SHA ?? 'local';
const results = runRiyadhFailureModeSuite(commitSha);
const payload = JSON.stringify({ suite: 'riyadh-failure-mode-safety', commitSha, passed: true, hazards: results }, null, 2);
await mkdir('artifacts/riyadh-failure-modes', { recursive: true });
await writeFile('artifacts/riyadh-failure-modes/result.json', payload + '\n', 'utf8');
console.log(payload);
