import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateControlledFieldLabEvidence } from '../pilot/controlled-field-lab-evidence.js';
import {
  parseRealDeviceEvidenceBundle,
  verifyRealDeviceEvidenceFiles
} from '../pilot/real-device-evidence.js';

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const evidenceRoot = process.argv[3];
  const expectedCandidateHeadSha = process.argv[4];
  if (
    inputPath === undefined || inputPath.trim().length === 0 ||
    evidenceRoot === undefined || evidenceRoot.trim().length === 0 ||
    expectedCandidateHeadSha === undefined || expectedCandidateHeadSha.trim().length === 0
  ) {
    throw new TypeError(
      'Usage: node dist/e2e/run-real-device-evidence-validation.js <bundle.json> <evidence-root> <expected-candidate-head-sha>'
    );
  }

  const absolutePath = resolve(process.cwd(), inputPath);
  const source = await readFile(absolutePath, 'utf8');
  const parsed: unknown = JSON.parse(source);
  const bundle = parseRealDeviceEvidenceBundle(parsed);
  const verification = await verifyRealDeviceEvidenceFiles(bundle, evidenceRoot, expectedCandidateHeadSha);
  const result = evaluateControlledFieldLabEvidence(bundle, verification);

  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'PASS') process.exitCode = 2;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`real-device evidence validation failed: ${message}\n`);
  process.exitCode = 1;
});
