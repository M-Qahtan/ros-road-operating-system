import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateRealDeviceEvidence } from '../pilot/real-device-evidence.js';

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (inputPath === undefined || inputPath.trim().length === 0) {
    throw new TypeError('Usage: node dist/e2e/run-real-device-evidence-validation.js <bundle.json>');
  }

  const absolutePath = resolve(process.cwd(), inputPath);
  const source = await readFile(absolutePath, 'utf8');
  const parsed: unknown = JSON.parse(source);
  const result = evaluateRealDeviceEvidence(parsed);

  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'PASS') process.exitCode = 2;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`real-device evidence validation failed: ${message}\n`);
  process.exitCode = 1;
});
