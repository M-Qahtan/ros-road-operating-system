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
  assert.equal(allowed.authorityPolicyVersion, 'ros-eye.authority.v1');
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
    assert.equal(result.authorityPolicyVersion, 'ros-eye.authority.v1');
  }
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
