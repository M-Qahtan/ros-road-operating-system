import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideHumanSafetyTransition,
  validateHumanSafetySignalEnvelope
} from '@ros/contracts';

const CASE_ID = '93000000-0000-4000-8000-000000000001';
const SUPERVISOR_ID = '93000000-0000-4000-8000-000000000011';
const OTHER_SUPERVISOR_ID = '93000000-0000-4000-8000-000000000012';

const current = {
  id: CASE_ID,
  state: 'MONITORED' as const,
  severity: 'S3' as const,
  version: 8,
  severityAssessmentVersion: 4,
  evidenceRevision: 5,
  indicatorRevision: 6,
  highRiskResolutionAuthorization: {
    caseId: CASE_ID,
    decision: 'RESOLVE' as const,
    actorId: SUPERVISOR_ID,
    role: 'SUPERVISOR' as const,
    reason: 'Reviewed current evidence and indicators',
    authorizedAt: '2026-07-27T12:00:00.000Z',
    expiresAt: '2026-07-27T12:10:00.000Z',
    caseVersion: 8,
    severityAssessmentVersion: 4,
    evidenceRevision: 5,
    indicatorRevision: 6,
    connectivity: 'HEALTHY' as const,
    dependenciesHealthy: true
  }
};

const context = {
  actorId: SUPERVISOR_ID,
  actorRoles: ['SUPERVISOR'] as const,
  reason: 'Contract test',
  traceId: 'authority-contract-test',
  occurredAt: '2026-07-27T12:05:00.000Z',
  connectivity: 'HEALTHY' as const,
  evidenceQuality: 'TRUSTED' as const,
  dependenciesHealthy: true
};

test('high-risk authorization is bound to the authorizing and executing supervisor', () => {
  const allowed = decideHumanSafetyTransition(current, 'RESOLVED', context);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.authorityPolicyVersion, 'ros-eye.authority.v2');
  assert.equal(allowed.evaluatedAuthority, 'RESOLVE');

  const otherSupervisor = decideHumanSafetyTransition(current, 'RESOLVED', {
    ...context,
    actorId: OTHER_SUPERVISOR_ID
  });
  assert.equal(otherSupervisor.allowed, false);
  assert.equal(otherSupervisor.nextState, 'HUMAN_REVIEW');
  assert.equal(otherSupervisor.reasonCode, 'stale_or_invalid_authorization');
});

test('authorization role must still be active for the executing actor', () => {
  const revoked = decideHumanSafetyTransition(current, 'RESOLVED', {
    ...context,
    actorRoles: ['OPERATOR'] as const
  });
  assert.equal(revoked.allowed, false);
  assert.equal(revoked.reasonCode, 'stale_or_invalid_authorization');
});

test('auditor and simulated channel fail closed for operational transitions', () => {
  for (const actorRoles of [['AUDITOR'], ['SIMULATED_CHANNEL']] as const) {
    const result = decideHumanSafetyTransition({
      ...current,
      state: 'RESOLVED' as const,
      version: current.version + 1
    }, 'ESCALATED', {
      ...context,
      actorRoles,
      reactivationCause: 'LATE_HIGH_RISK_SIGNAL'
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'actor_not_authorized');
    assert.equal(result.authorityPolicyVersion, 'ros-eye.authority.v2');
  }
});

test('channel indicator authority cannot change contact outcome state', () => {
  for (const requestedState of ['RESPONDED', 'NO_RESPONSE', 'UNREACHABLE'] as const) {
    const result = decideHumanSafetyTransition({
      ...current,
      state: 'CONTACTING' as const,
      severity: 'S2' as const,
      highRiskResolutionAuthorization: null
    }, requestedState, {
      ...context,
      actorRoles: ['SIMULATED_CHANNEL'] as const
    });
    assert.equal(result.allowed, false);
    assert.equal(result.requiredAuthority, 'UPDATE_CONTACT_OUTCOME');
    assert.equal(result.reasonCode, 'actor_not_authorized');
  }
});

test('operator may record a contact outcome through explicit operational authority', () => {
  const result = decideHumanSafetyTransition({
    ...current,
    state: 'CONTACTING' as const,
    severity: 'S2' as const,
    highRiskResolutionAuthorization: null
  }, 'RESPONDED', {
    ...context,
    actorRoles: ['OPERATOR'] as const
  });
  assert.equal(result.allowed, true);
  assert.equal(result.evaluatedAuthority, 'UPDATE_CONTACT_OUTCOME');
});

test('operator may escalate a resolved case but cannot use another actor high-risk authorization', () => {
  const reactivation = decideHumanSafetyTransition({
    ...current,
    state: 'RESOLVED' as const,
    version: current.version + 1
  }, 'ESCALATED', {
    ...context,
    actorId: '93000000-0000-4000-8000-000000000020',
    actorRoles: ['OPERATOR'] as const,
    reactivationCause: 'CONTRADICTORY_INDICATOR'
  });
  assert.equal(reactivation.allowed, true);
  assert.equal(reactivation.evaluatedAuthority, 'ESCALATE');
});

function validPhoneSignal() {
  return {
    signalId: 'signal-001',
    schemaVersion: 'ros-eye.signal.v1',
    purposePolicyVersion: 'ros-eye.purpose.v1',
    dataClassification: 'SENSITIVE_RESTRICTED',
    retentionClass: 'SHORT_LIVED_SIGNAL_METADATA',
    sourceType: 'PHONE',
    sourceId: 'device-pseudonym-001',
    occurredAt: '2026-07-27T12:00:00.000Z',
    receivedAt: '2026-07-27T12:00:01.000Z',
    consentBasis: 'EXPLICIT',
    integrity: {
      replayToken: 'replay-token-001',
      signatureStatus: 'VERIFIED',
      clockSkewMs: 1000
    },
    location: null,
    payload: {
      kind: 'PHONE_MOTION',
      accelerationMagnitude: 18.4,
      impactDetected: true
    }
  };
}

test('strict signal envelope accepts a versioned minimum-necessary payload', () => {
  const result = validateHumanSafetySignalEnvelope(validPhoneSignal());
  assert.deepEqual(result, { accepted: true, disposition: 'ACCEPT', reasonCode: 'accepted' });
});

test('free text, medical narratives, identifiers and unknown payload fields are quarantined', () => {
  for (const prohibited of [
    { freeText: 'I have severe pain' },
    { medicalNarrative: 'possible diagnosis' },
    { phoneNumber: '+966500000000' },
    { preciseLocation: { latitude: 24.7, longitude: 46.6 } },
    { vendorOpaqueData: 'unreviewed' }
  ]) {
    const signal = validPhoneSignal();
    const result = validateHumanSafetySignalEnvelope({
      ...signal,
      payload: { ...signal.payload, ...prohibited }
    });
    assert.equal(result.accepted, false);
    assert.equal(result.disposition, 'QUARANTINE');
  }
});

test('source and payload mismatch routes to human review', () => {
  const signal = validPhoneSignal();
  const result = validateHumanSafetySignalEnvelope({
    ...signal,
    sourceType: 'VEHICLE'
  });
  assert.equal(result.accepted, false);
  assert.equal(result.disposition, 'HUMAN_REVIEW');
  assert.equal(result.reasonCode, 'source_payload_mismatch');
});

test('invalid signatures and malformed identifiers fail closed', () => {
  const signal = validPhoneSignal();
  const invalidSignature = validateHumanSafetySignalEnvelope({
    ...signal,
    integrity: { ...signal.integrity, signatureStatus: 'INVALID' }
  });
  assert.deepEqual(invalidSignature, { accepted: false, disposition: 'QUARANTINE', reasonCode: 'invalid_signature' });

  const missingReplayToken = validateHumanSafetySignalEnvelope({
    ...signal,
    integrity: { ...signal.integrity, replayToken: '  ' }
  });
  assert.equal(missingReplayToken.accepted, false);
  assert.equal(missingReplayToken.reasonCode, 'invalid_integrity_metadata');
});

test('unverified signature and excessive clock skew require human review', () => {
  const signal = validPhoneSignal();
  const unverified = validateHumanSafetySignalEnvelope({
    ...signal,
    integrity: { ...signal.integrity, signatureStatus: 'UNVERIFIED' }
  });
  assert.equal(unverified.disposition, 'HUMAN_REVIEW');

  const skewed = validateHumanSafetySignalEnvelope({
    ...signal,
    integrity: { ...signal.integrity, clockSkewMs: 300_001 }
  });
  assert.deepEqual(skewed, { accepted: false, disposition: 'HUMAN_REVIEW', reasonCode: 'clock_skew_exceeded' });
});

test('invalid chronology, probabilities, coordinates and indicator codes are quarantined', () => {
  const signal = validPhoneSignal();
  const cases = [
    { ...signal, occurredAt: 'not-a-date' },
    { ...signal, occurredAt: '2026-07-27T12:01:00.000Z', receivedAt: '2026-07-27T12:00:00.000Z' },
    { ...signal, payload: { ...signal.payload, accelerationMagnitude: Number.NaN } },
    { ...signal, location: { latitude: 91, longitude: 46.6, accuracyMeters: 1, classification: 'PRECISE_RESTRICTED' } },
    { ...signal, sourceType: 'PERSON', payload: { kind: 'PERSON_REPORT', indicatorCodes: ['UNKNOWN_INDICATOR'] } }
  ];
  for (const candidate of cases) {
    const result = validateHumanSafetySignalEnvelope(candidate);
    assert.equal(result.accepted, false);
    assert.equal(result.disposition, 'QUARANTINE');
  }
});

test('purpose, consent, classification and retention must remain coherent', () => {
  const signal = validPhoneSignal();
  for (const candidate of [
    { ...signal, consentBasis: 'SIMULATION' },
    { ...signal, dataClassification: 'OPERATIONAL' },
    { ...signal, retentionClass: 'SIMULATION_ONLY' }
  ]) {
    const result = validateHumanSafetySignalEnvelope(candidate);
    assert.deepEqual(result, { accepted: false, disposition: 'QUARANTINE', reasonCode: 'purpose_classification_mismatch' });
  }
});
