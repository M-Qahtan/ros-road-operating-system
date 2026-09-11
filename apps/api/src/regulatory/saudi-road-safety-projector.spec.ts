import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAUDI_ROAD_SAFETY_PROFILE,
  type SaudiRoadSafetyInteroperabilityState,
} from '@ros/contracts';
import { projectSaudiCrashRecord } from './saudi-road-safety-projector.js';

const mappingDigest = 'a'.repeat(64);

function interop(nrscMarsad: SaudiRoadSafetyInteroperabilityState['nrscMarsad']): SaudiRoadSafetyInteroperabilityState {
  return {
    profile: SAUDI_ROAD_SAFETY_PROFILE,
    nrscMarsad,
    roadCodeMappingVersion: 'SHC-2024-internal-mapping-v1',
    mappingDigest,
  };
}

function baseInput(status: SaudiRoadSafetyInteroperabilityState['nrscMarsad'] = 'ICD_REQUIRED') {
  return {
    eventId: 'INC-RUH-001',
    occurredAt: '2026-09-11T06:55:00+03:00',
    latitude: 24.7136,
    longitude: 46.6753,
    roadSegmentId: 'RUH-R1-S42',
    direction: 'N',
    laneContext: ['L2'],
    rosType: 'COLLISION' as const,
    severity: 'S3' as const,
    confidence: 0.91,
    environment: { visibility: 'NORMAL' },
    participants: { vehicles: 2, pedestrians: 0, vulnerableRoadUsers: 0 },
    evidenceSummary: { independentSources: 3, contradictions: 0, manifestId: 'EVM-001' },
    lifecycle: { detectedAt: '2026-09-11T06:55:02+03:00' },
    privacy: {
      purpose: 'road-safety-analysis',
      legalBasis: 'APPROVED_CONTROLLER_BASIS',
      dataClassification: 'RESTRICTED',
      retentionPolicy: 'ROS-SA-INCIDENT-V1',
      jurisdiction: 'SA' as const,
      controller: 'ROS-CONTROLLER',
      allowedRecipients: ['AUTHORIZED_ROAD_SAFETY_AUTHORITY'],
      crossBorderStatus: 'LOCAL_ONLY' as const,
    },
    interoperability: interop(status),
  };
}

test('ICD-required projection is valid but government transmission stays blocked', () => {
  const result = projectSaudiCrashRecord(baseInput());

  assert.equal(result.record.classification.localAuthorityCode, null);
  assert.equal(result.record.classification.legalViolationConfirmed, false);
  assert.equal(result.transmissionGate, 'AUTHORITATIVE_ICD_REQUIRED');
  assert.equal(result.transmissionAuthorized, false);
  assert.equal(result.networkCalls, 0);
  assert.equal(result.legalEnforcementAuthority, 'NONE');
});

test('mapping-ready state still requires certification and performs no transmission', () => {
  const result = projectSaudiCrashRecord(baseInput('MAPPING_READY'));
  assert.equal(result.transmissionGate, 'CERTIFICATION_REQUIRED');
  assert.equal(result.transmissionAuthorized, false);
  assert.equal(result.networkCalls, 0);
});

test('certified mapping does not self-authorize a government network call', () => {
  const result = projectSaudiCrashRecord(baseInput('CERTIFIED'));
  assert.equal(result.transmissionGate, 'SEPARATE_EXTERNAL_AUTHORIZATION_REQUIRED');
  assert.equal(result.transmissionAuthorized, false);
  assert.equal(result.networkCalls, 0);
});

test('invalid mapping digest fails closed before projection can be used', () => {
  const input = baseInput();
  assert.throws(
    () => projectSaudiCrashRecord({ ...input, interoperability: { ...input.interoperability, mappingDigest: 'bad' } }),
    /INVALID_SAUDI_INTEROP_STATE/,
  );
});

test('projection rejects invalid participant counts', () => {
  const input = baseInput();
  assert.throws(
    () => projectSaudiCrashRecord({ ...input, participants: { vehicles: -1, pedestrians: 0, vulnerableRoadUsers: 0 } }),
    /INVALID_PARTICIPANT_COUNT/,
  );
});
