import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRealDeviceEvidence,
  parseRealDeviceEvidenceBundle,
  realDeviceEvidenceBundleSha256
} from './real-device-evidence.js';

const HEAD = '2184bad8d076604269fbf74a5e5e4d8d64730680';
const BUILD = 'a'.repeat(64);
const FILE_SHA = 'b'.repeat(64);

type EvidenceFileFixture = {
  path: string;
  sha256: string;
  sizeBytes: number;
};

type ScenarioFixture = {
  caseId: string;
  kind: string;
  outcome: string;
  duplicateLogicalActionsObserved: number;
  staleUnsafeActionsObserved: number;
  privacyDataMinimized: boolean;
  evidenceFiles: EvidenceFileFixture[];
};

type SessionFixture = {
  sessionId: string;
  candidateHeadSha: string;
  environment: string;
  device: {
    platform: 'ANDROID' | 'IOS';
    model: string;
    osVersion: string;
    appBuildSha256: string;
    locale: string;
    screenReader: 'TALKBACK' | 'VOICEOVER';
  };
  startedAt: string;
  completedAt: string;
  scenarios: ScenarioFixture[];
};

type BundleFixture = {
  schema: string;
  sessions: SessionFixture[];
};

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`test fixture missing ${label}`);
  return value;
}

function sessionAt(bundle: BundleFixture, index: number): SessionFixture {
  return required(bundle.sessions[index], `sessions[${index}]`);
}

function scenarioAt(session: SessionFixture, index: number): ScenarioFixture {
  return required(session.scenarios[index], `scenario[${index}]`);
}

function evidenceAt(scenario: ScenarioFixture, index: number): EvidenceFileFixture {
  return required(scenario.evidenceFiles[index], `evidenceFiles[${index}]`);
}

function evidenceFile(name: string): EvidenceFileFixture {
  return {
    path: `field/${name}.json`,
    sha256: FILE_SHA,
    sizeBytes: 128
  };
}

function scenario(caseId: string, kind: string, overrides: Partial<ScenarioFixture> = {}): ScenarioFixture {
  return {
    caseId,
    kind,
    outcome: 'PASS',
    duplicateLogicalActionsObserved: 0,
    staleUnsafeActionsObserved: 0,
    privacyDataMinimized: true,
    evidenceFiles: [evidenceFile(caseId)],
    ...overrides
  };
}

function session(
  sessionId: string,
  platform: 'ANDROID' | 'IOS',
  screenReader: 'TALKBACK' | 'VOICEOVER',
  scenarios: ScenarioFixture[],
  overrides: Partial<SessionFixture> = {}
): SessionFixture {
  return {
    sessionId,
    candidateHeadSha: HEAD,
    environment: 'CONTROLLED_FIELD_LAB',
    device: {
      platform,
      model: platform === 'ANDROID' ? 'reference-android' : 'reference-ios',
      osVersion: platform === 'ANDROID' ? 'Android-reference' : 'iOS-reference',
      appBuildSha256: BUILD,
      locale: platform === 'ANDROID' ? 'ar-SA' : 'en-SA',
      screenReader
    },
    startedAt: '2026-08-20T04:00:00.000Z',
    completedAt: '2026-08-20T04:10:00.000Z',
    scenarios,
    ...overrides
  };
}

function completeBundle(): BundleFixture {
  return {
    schema: 'ros-real-device-evidence/v1',
    sessions: [
      session('android-session-001', 'ANDROID', 'TALKBACK', [
        scenario('android-critical', 'CRITICAL_FLOW'),
        scenario('android-gps', 'GPS_DEGRADATION'),
        scenario('android-network', 'NETWORK_LOSS'),
        scenario('android-restart', 'RESTART_RECONNECT'),
        scenario('android-talkback', 'SCREEN_READER')
      ]),
      session('ios-session-001', 'IOS', 'VOICEOVER', [
        scenario('ios-critical', 'CRITICAL_FLOW'),
        scenario('ios-voiceover', 'SCREEN_READER')
      ])
    ]
  };
}

test('complete Android+iOS controlled-field evidence passes without authorizing a pilot', () => {
  const result = evaluateRealDeviceEvidence(completeBundle());
  assert.equal(result.status, 'PASS');
  assert.equal(result.evidenceIntegrityVerified, true);
  assert.equal(result.representativeRealDeviceCriticalFlowsPassed, true);
  assert.equal(result.gpsDegradationSafeStateVerified, true);
  assert.equal(result.networkLossSafeStateVerified, true);
  assert.equal(result.restartReconnectSafeStateVerified, true);
  assert.equal(result.screenReaderCriticalFlowsPassed, true);
  assert.equal(result.duplicateLogicalActionsObserved, 0);
  assert.equal(result.staleStateUnsafeActionsObserved, 0);
  assert.deepEqual(result.missingCoverage, []);
  assert.deepEqual(result.blockingReasons, []);
  assert.match(result.bundleSha256, /^[a-f0-9]{64}$/);
});

test('missing iOS critical-flow coverage remains NO_GO', () => {
  const bundle = completeBundle();
  sessionAt(bundle, 1).scenarios = [scenario('ios-voiceover', 'SCREEN_READER')];
  const result = evaluateRealDeviceEvidence(bundle);
  assert.equal(result.status, 'NO_GO');
  assert.equal(result.representativeRealDeviceCriticalFlowsPassed, false);
  assert.ok(result.missingCoverage.includes('Android+iOS critical-flow coverage'));
});

test('TalkBack and VoiceOver are both required for screen-reader completion', () => {
  const bundle = completeBundle();
  sessionAt(bundle, 1).scenarios = [scenario('ios-critical', 'CRITICAL_FLOW')];
  const result = evaluateRealDeviceEvidence(bundle);
  assert.equal(result.status, 'NO_GO');
  assert.equal(result.screenReaderCriticalFlowsPassed, false);
  assert.ok(result.missingCoverage.includes('TalkBack+VoiceOver critical-flow coverage'));
});

test('duplicate logical action is a hard evidence failure', () => {
  const bundle = completeBundle();
  sessionAt(bundle, 0).scenarios[0] = scenario('android-critical', 'CRITICAL_FLOW', {
    duplicateLogicalActionsObserved: 1
  });
  const result = evaluateRealDeviceEvidence(bundle);
  assert.equal(result.status, 'NO_GO');
  assert.equal(result.duplicateLogicalActionsObserved, 1);
  assert.match(result.blockingReasons.join(' | '), /duplicate logical actions/);
});

test('unsafe stale-state action is a hard evidence failure', () => {
  const bundle = completeBundle();
  sessionAt(bundle, 0).scenarios[2] = scenario('android-network', 'NETWORK_LOSS', {
    staleUnsafeActionsObserved: 1
  });
  const result = evaluateRealDeviceEvidence(bundle);
  assert.equal(result.status, 'NO_GO');
  assert.equal(result.staleStateUnsafeActionsObserved, 1);
  assert.match(result.blockingReasons.join(' | '), /unsafe stale-state actions/);
});

test('failed scenario and data-minimization violation remain NO_GO', () => {
  const failed = completeBundle();
  sessionAt(failed, 0).scenarios[1] = scenario('android-gps', 'GPS_DEGRADATION', { outcome: 'FAIL' });
  const failedResult = evaluateRealDeviceEvidence(failed);
  assert.equal(failedResult.status, 'NO_GO');
  assert.match(failedResult.blockingReasons.join(' | '), /did not PASS/);

  const privacy = completeBundle();
  sessionAt(privacy, 0).scenarios[1] = scenario('android-gps', 'GPS_DEGRADATION', { privacyDataMinimized: false });
  const privacyResult = evaluateRealDeviceEvidence(privacy);
  assert.equal(privacyResult.status, 'NO_GO');
  assert.match(privacyResult.blockingReasons.join(' | '), /data minimization/);
});

test('duplicate session IDs, duplicate case IDs and mixed candidate heads are rejected', () => {
  const duplicateSession = completeBundle();
  sessionAt(duplicateSession, 1).sessionId = sessionAt(duplicateSession, 0).sessionId;
  assert.throws(() => parseRealDeviceEvidenceBundle(duplicateSession), /duplicate sessionId/);

  const duplicateCase = completeBundle();
  sessionAt(duplicateCase, 0).scenarios.push(scenario('android-critical', 'NETWORK_LOSS'));
  assert.throws(() => parseRealDeviceEvidenceBundle(duplicateCase), /duplicate caseId/);

  const mixedHead = completeBundle();
  sessionAt(mixedHead, 1).candidateHeadSha = 'c'.repeat(40);
  assert.throws(() => parseRealDeviceEvidenceBundle(mixedHead), /same candidate head/);
});

test('unsafe evidence path, malformed digest and platform/screen-reader mismatch are rejected', () => {
  const unsafePath = completeBundle();
  evidenceAt(scenarioAt(sessionAt(unsafePath, 0), 0), 0).path = '../escape.json';
  assert.throws(() => parseRealDeviceEvidenceBundle(unsafePath), /safe relative evidence path/);

  const badDigest = completeBundle();
  evidenceAt(scenarioAt(sessionAt(badDigest, 0), 0), 0).sha256 = 'not-a-digest';
  assert.throws(() => parseRealDeviceEvidenceBundle(badDigest), /SHA-256/);

  const wrongReader = completeBundle();
  sessionAt(wrongReader, 0).device.screenReader = 'VOICEOVER';
  assert.throws(() => parseRealDeviceEvidenceBundle(wrongReader), /invalid for Android/);
});

test('unknown fields are rejected rather than silently ignored', () => {
  const bundle = completeBundle() as BundleFixture & { selfAttestedApproval?: boolean };
  bundle.selfAttestedApproval = true;
  assert.throws(() => parseRealDeviceEvidenceBundle(bundle), /is not allowed/);
});

test('bundle hash is stable across input object key ordering', () => {
  const normal = parseRealDeviceEvidenceBundle(completeBundle());
  const reordered = parseRealDeviceEvidenceBundle({
    sessions: completeBundle().sessions,
    schema: 'ros-real-device-evidence/v1'
  });
  assert.equal(realDeviceEvidenceBundleSha256(normal), realDeviceEvidenceBundleSha256(reordered));
});
