import assert from 'node:assert/strict';
import test from 'node:test';
import { RealDeviceEvidenceBundle } from './real-device-evidence.js';
import { evaluateRequiredLocaleCoverage } from './controlled-field-lab-evidence.js';

const HEAD = 'c'.repeat(40);
const BUILD = 'a'.repeat(64);
const FILE_SHA = 'b'.repeat(64);

function session(
  sessionId: string,
  locale: string,
  platform: 'ANDROID' | 'IOS',
  overrides: Partial<{
    outcome: 'PASS' | 'FAIL';
    duplicateLogicalActionsObserved: number;
    staleUnsafeActionsObserved: number;
    privacyDataMinimized: boolean;
  }> = {}
): RealDeviceEvidenceBundle['sessions'][number] {
  return {
    sessionId,
    candidateHeadSha: HEAD,
    environment: 'CONTROLLED_FIELD_LAB',
    device: {
      platform,
      model: `${platform.toLowerCase()}-reference`,
      osVersion: `${platform}-reference`,
      appBuildSha256: BUILD,
      locale,
      screenReader: 'NONE'
    },
    startedAt: '2026-08-23T18:00:00.000Z',
    completedAt: '2026-08-23T18:05:00.000Z',
    scenarios: [{
      caseId: `${sessionId}-critical`,
      kind: 'CRITICAL_FLOW',
      outcome: overrides.outcome ?? 'PASS',
      duplicateLogicalActionsObserved: overrides.duplicateLogicalActionsObserved ?? 0,
      staleUnsafeActionsObserved: overrides.staleUnsafeActionsObserved ?? 0,
      privacyDataMinimized: overrides.privacyDataMinimized ?? true,
      evidenceFiles: [{ path: `field/${sessionId}.json`, sha256: FILE_SHA, sizeBytes: 1 }]
    }]
  };
}

function bundle(...sessions: RealDeviceEvidenceBundle['sessions'][number][]): RealDeviceEvidenceBundle {
  return { schema: 'ros-real-device-evidence/v1', sessions };
}

test('Arabic, English and Urdu passing critical flows satisfy the controlled-lab locale gate', () => {
  const result = evaluateRequiredLocaleCoverage(bundle(
    session('android-ar-001', 'ar-SA', 'ANDROID'),
    session('ios-en-001', 'en-SA', 'IOS'),
    session('android-ur-001', 'ur-PK', 'ANDROID')
  ));
  assert.equal(result.requiredLocaleCriticalFlowsPassed, true);
  assert.deepEqual(result.passedRequiredLocales, ['ar', 'en', 'ur']);
  assert.deepEqual(result.missingRequiredLocales, []);
});

test('missing Urdu critical flow remains incomplete', () => {
  const result = evaluateRequiredLocaleCoverage(bundle(
    session('android-ar-001', 'ar-SA', 'ANDROID'),
    session('ios-en-001', 'en-US', 'IOS')
  ));
  assert.equal(result.requiredLocaleCriticalFlowsPassed, false);
  assert.deepEqual(result.missingRequiredLocales, ['ur']);
});

test('failed, privacy-violating, duplicate or stale-unsafe flows never satisfy a locale', () => {
  const result = evaluateRequiredLocaleCoverage(bundle(
    session('android-ar-001', 'ar-SA', 'ANDROID'),
    session('ios-en-001', 'en-US', 'IOS'),
    session('android-ur-fail', 'ur-PK', 'ANDROID', { outcome: 'FAIL' }),
    session('android-ur-duplicate', 'ur-PK', 'ANDROID', { duplicateLogicalActionsObserved: 1 }),
    session('android-ur-stale', 'ur-PK', 'ANDROID', { staleUnsafeActionsObserved: 1 }),
    session('android-ur-privacy', 'ur-PK', 'ANDROID', { privacyDataMinimized: false })
  ));
  assert.equal(result.requiredLocaleCriticalFlowsPassed, false);
  assert.deepEqual(result.missingRequiredLocales, ['ur']);
});
