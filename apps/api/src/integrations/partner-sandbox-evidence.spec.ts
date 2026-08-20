import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  evaluatePartnerSandboxEvidence,
  parsePartnerSandboxEvidenceBundle,
  parsePartnerSandboxExpectedContext,
  PartnerSandboxExpectedContext,
  verifyPartnerSandboxEvidence
} from './partner-sandbox-evidence.js';

const HEAD = '4e89dea640d4dc351e644bb55de1fd0115f7371b';
const CERT_A = 'a'.repeat(64);
const CERT_B = 'b'.repeat(64);
const RECEIPT_BYTES = Buffer.from('synthetic approved-sandbox receipt fixture\n', 'utf8');
const RECEIPT_SHA = createHash('sha256').update(RECEIPT_BYTES).digest('hex');

interface ReceiptFixture {
  path: string;
  sha256: string;
  sizeBytes: number;
}

interface BundleFixture {
  schema: string;
  sessionId: string;
  candidateHeadSha: string;
  startedAt: string;
  completedAt: string;
  observedProfile: {
    profileId: string;
    partner: string;
    tenantId: string;
    purpose: string;
    environment: string;
    sandboxEndpointBaseUrl: string;
    certificateFingerprintSha256: string;
    jwsKid: string;
  };
  summary: {
    networkCalls: number;
    exactlyOneLogicalActionVerified: boolean;
    duplicateLogicalActionsObserved: number;
    callbackAuthenticationVerified: boolean;
    callbackReplayRejected: boolean;
    delayedCallbackRejected: boolean;
    outageRecoveryVerified: boolean;
    statusCancelSemanticsVerified: boolean;
    minimumNecessaryProjectionVerified: boolean;
    dataMinimized: boolean;
    operationalAuthorityGranted: boolean;
    productionActivationEnabled: boolean;
    realEmergencyDispatchPerformed: boolean;
    publicRoadActionPerformed: boolean;
  };
  receiptFiles: ReceiptFixture[];
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`test fixture missing ${label}`);
  return value;
}

function receiptAt(fixture: BundleFixture, index: number): ReceiptFixture {
  return required(fixture.receiptFiles[index], `receiptFiles[${index}]`);
}

function bundle(): BundleFixture {
  return {
    schema: 'ros-partner-sandbox-evidence/v1',
    sessionId: 'traffic-sandbox-session-001',
    candidateHeadSha: HEAD,
    startedAt: '2026-08-20T05:10:00.000Z',
    completedAt: '2026-08-20T05:20:00.000Z',
    observedProfile: {
      profileId: 'traffic-sandbox-v1',
      partner: 'TRAFFIC',
      tenantId: 'riyadh-pilot-tenant',
      purpose: 'TRAFFIC_COORDINATION',
      environment: 'SANDBOX',
      sandboxEndpointBaseUrl: 'https://sandbox.example.invalid/ros',
      certificateFingerprintSha256: CERT_A,
      jwsKid: 'traffic-key-2026-a'
    },
    summary: {
      networkCalls: 8,
      exactlyOneLogicalActionVerified: true,
      duplicateLogicalActionsObserved: 0,
      callbackAuthenticationVerified: true,
      callbackReplayRejected: true,
      delayedCallbackRejected: true,
      outageRecoveryVerified: true,
      statusCancelSemanticsVerified: true,
      minimumNecessaryProjectionVerified: true,
      dataMinimized: true,
      operationalAuthorityGranted: false,
      productionActivationEnabled: false,
      realEmergencyDispatchPerformed: false,
      publicRoadActionPerformed: false
    },
    receiptFiles: [{
      path: 'receipts/traffic-session.json',
      sha256: RECEIPT_SHA,
      sizeBytes: RECEIPT_BYTES.byteLength
    }]
  };
}

function expected(overrides: Partial<PartnerSandboxExpectedContext> = {}): PartnerSandboxExpectedContext {
  return {
    expectedCandidateHeadSha: HEAD,
    profileId: 'traffic-sandbox-v1',
    partner: 'TRAFFIC',
    tenantId: 'riyadh-pilot-tenant',
    purpose: 'TRAFFIC_COORDINATION',
    sandboxEndpointBaseUrl: 'https://sandbox.example.invalid/ros',
    allowedCredentialPairs: [
      { certificateFingerprintSha256: CERT_A, jwsKid: 'traffic-key-2026-a' },
      { certificateFingerprintSha256: CERT_B, jwsKid: 'traffic-key-2026-b' }
    ],
    approvalReference: 'sandbox-window-2026-001',
    approvedFrom: '2026-08-20T05:00:00.000Z',
    approvedUntil: '2026-08-20T06:00:00.000Z',
    ...overrides
  };
}

async function withReceiptRoot<T>(fixture: BundleFixture, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'ros-partner-sandbox-evidence-'));
  try {
    for (const receipt of fixture.receiptFiles) {
      const target = join(root, receipt.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, RECEIPT_BYTES);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('trusted byte-verified package is only ready for external semantic review', async () => {
  const raw = bundle();
  const parsed = parsePartnerSandboxEvidenceBundle(raw);
  await withReceiptRoot(raw, async (root) => {
    const verification = await verifyPartnerSandboxEvidence(parsed, root, expected());
    const decision = evaluatePartnerSandboxEvidence(parsed, verification);
    assert.equal(decision.status, 'PACKAGE_READY_FOR_EXTERNAL_REVIEW');
    assert.equal(decision.activationAuthorized, false);
    assert.equal(decision.semanticClaimsIndependentlyVerified, false);
    assert.equal(decision.summaryClaimsRequireExternalReview, true);
    assert.equal(decision.candidateHeadVerified, true);
    assert.equal(decision.trustedProfileBindingVerified, true);
    assert.equal(decision.approvedWindowVerified, true);
    assert.equal(decision.evidenceIntegrityVerified, true);
    assert.equal(decision.receiptFileCount, 1);
    assert.equal(decision.networkCallsClaimed, 8);
    assert.deepEqual(decision.blockingReasons, []);
  });
});

test('metadata-only sandbox package can never become review-ready', () => {
  const decision = evaluatePartnerSandboxEvidence(bundle());
  assert.equal(decision.status, 'NO_GO');
  assert.equal(decision.activationAuthorized, false);
  assert.equal(decision.semanticClaimsIndependentlyVerified, false);
  assert.equal(decision.candidateHeadVerified, false);
  assert.equal(decision.evidenceIntegrityVerified, false);
});

test('trusted expected head, profile scope, endpoint and credential pair are mandatory', async () => {
  const raw = bundle();
  const parsed = parsePartnerSandboxEvidenceBundle(raw);
  await withReceiptRoot(raw, async (root) => {
    await assert.rejects(
      verifyPartnerSandboxEvidence(parsed, root, expected({ expectedCandidateHeadSha: 'c'.repeat(40) })),
      /trusted expected head/
    );
    await assert.rejects(
      verifyPartnerSandboxEvidence(parsed, root, expected({ tenantId: 'other-tenant' })),
      /trusted expected profile/
    );
    await assert.rejects(
      verifyPartnerSandboxEvidence(parsed, root, expected({ sandboxEndpointBaseUrl: 'https://other.example.invalid/ros' })),
      /trusted expected profile/
    );
    await assert.rejects(
      verifyPartnerSandboxEvidence(parsed, root, expected({
        allowedCredentialPairs: [{ certificateFingerprintSha256: CERT_B, jwsKid: 'traffic-key-2026-b' }]
      })),
      /trusted expected profile/
    );
  });
});

test('expected context rejects unknown sensitive fields and duplicate credential pairs', () => {
  const withSecret = {
    ...expected(),
    clientSecret: 'must-never-be-accepted-here'
  };
  assert.throws(() => parsePartnerSandboxExpectedContext(withSecret), /clientSecret is not allowed/);

  const duplicatePair = expected({
    allowedCredentialPairs: [
      { certificateFingerprintSha256: CERT_A, jwsKid: 'traffic-key-2026-a' },
      { certificateFingerprintSha256: CERT_A, jwsKid: 'traffic-key-2026-a' }
    ]
  });
  assert.throws(() => parsePartnerSandboxExpectedContext(duplicatePair), /duplicate pair/);
});

test('sandbox session must stay inside the externally approved window', async () => {
  const raw = bundle();
  raw.startedAt = '2026-08-20T04:59:59.000Z';
  const parsed = parsePartnerSandboxEvidenceBundle(raw);
  await withReceiptRoot(raw, async (root) => {
    await assert.rejects(verifyPartnerSandboxEvidence(parsed, root, expected()), /outside the approved window/);
  });
});

test('tampered receipt bytes are rejected before evaluation', async () => {
  const raw = bundle();
  const parsed = parsePartnerSandboxEvidenceBundle(raw);
  await withReceiptRoot(raw, async (root) => {
    await writeFile(join(root, receiptAt(raw, 0).path), Buffer.from('tampered\n', 'utf8'));
    await assert.rejects(verifyPartnerSandboxEvidence(parsed, root, expected()), /size mismatch|SHA-256 mismatch/);
  });
});

test('no network-call claim or duplicate logical actions remain NO_GO', () => {
  const noCalls = bundle();
  noCalls.summary.networkCalls = 0;
  const noCallsDecision = evaluatePartnerSandboxEvidence(noCalls);
  assert.equal(noCallsDecision.status, 'NO_GO');
  assert.match(noCallsDecision.blockingReasons.join(' | '), /does not claim an actual approved sandbox network call/);

  const duplicate = bundle();
  duplicate.summary.duplicateLogicalActionsObserved = 1;
  duplicate.summary.exactlyOneLogicalActionVerified = false;
  const duplicateDecision = evaluatePartnerSandboxEvidence(duplicate);
  assert.equal(duplicateDecision.status, 'NO_GO');
  assert.match(duplicateDecision.blockingReasons.join(' | '), /reports duplicate logical actions/);
});

test('missing positive semantic claims remain NO_GO pending review package completeness', () => {
  const fields = [
    'callbackAuthenticationVerified',
    'callbackReplayRejected',
    'delayedCallbackRejected',
    'outageRecoveryVerified',
    'statusCancelSemanticsVerified',
    'minimumNecessaryProjectionVerified',
    'dataMinimized'
  ] as const;
  for (const field of fields) {
    const raw = bundle();
    raw.summary[field] = false;
    const decision = evaluatePartnerSandboxEvidence(raw);
    assert.equal(decision.status, 'NO_GO', field);
    assert.equal(decision.semanticClaimsIndependentlyVerified, false, field);
  }
});

test('any operational, production, emergency or public-road authority is a hard NO_GO', () => {
  const fields = [
    'operationalAuthorityGranted',
    'productionActivationEnabled',
    'realEmergencyDispatchPerformed',
    'publicRoadActionPerformed'
  ] as const;
  for (const field of fields) {
    const raw = bundle();
    raw.summary[field] = true;
    const decision = evaluatePartnerSandboxEvidence(raw);
    assert.equal(decision.status, 'NO_GO', field);
    assert.equal(decision.activationAuthorized, false);
  }
});

test('partner-purpose mismatch and noncanonical sandbox endpoint are rejected', () => {
  const purpose = bundle();
  purpose.observedProfile.purpose = 'INSURANCE_COORDINATION';
  assert.throws(() => parsePartnerSandboxEvidenceBundle(purpose), /requires purpose/);

  const endpoint = bundle();
  endpoint.observedProfile.sandboxEndpointBaseUrl = 'https://sandbox.example.invalid/ros?token=not-allowed';
  assert.throws(() => parsePartnerSandboxEvidenceBundle(endpoint), /userinfo, query or fragment/);
});

test('unknown bundle fields and duplicate receipt paths are rejected', () => {
  const unknown = bundle() as BundleFixture & { authorizationMaterial?: string };
  unknown.authorizationMaterial = 'not-accepted';
  assert.throws(() => parsePartnerSandboxEvidenceBundle(unknown), /is not allowed/);

  const duplicate = bundle();
  duplicate.receiptFiles.push({ ...receiptAt(duplicate, 0) });
  assert.throws(() => parsePartnerSandboxEvidenceBundle(duplicate), /duplicate receipt path/);
});
