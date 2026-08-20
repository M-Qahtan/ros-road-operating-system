import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluatePartnerSandboxEvidence,
  parsePartnerSandboxEvidenceBundle,
  PartnerSandboxExpectedContext,
  verifyPartnerSandboxEvidence
} from '../integrations/partner-sandbox-evidence.js';

async function readJson(path: string): Promise<unknown> {
  const source = await readFile(resolve(process.cwd(), path), 'utf8');
  return JSON.parse(source) as unknown;
}

async function main(): Promise<void> {
  const bundlePath = process.argv[2];
  const evidenceRoot = process.argv[3];
  const expectedContextPath = process.argv[4];
  if (
    bundlePath === undefined || bundlePath.trim().length === 0 ||
    evidenceRoot === undefined || evidenceRoot.trim().length === 0 ||
    expectedContextPath === undefined || expectedContextPath.trim().length === 0
  ) {
    throw new TypeError(
      'Usage: node dist/e2e/run-partner-sandbox-evidence-validation.js <bundle.json> <evidence-root> <expected-context.json>'
    );
  }

  const bundleInput = await readJson(bundlePath);
  const expectedInput = await readJson(expectedContextPath);
  const bundle = parsePartnerSandboxEvidenceBundle(bundleInput);
  const verification = await verifyPartnerSandboxEvidence(
    bundle,
    evidenceRoot,
    expectedInput as PartnerSandboxExpectedContext
  );
  const decision = evaluatePartnerSandboxEvidence(bundle, verification);
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  if (decision.status !== 'VERIFIED_FOR_EXTERNAL_REVIEW') process.exitCode = 2;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`partner sandbox evidence validation failed: ${message}\n`);
  process.exitCode = 1;
});
