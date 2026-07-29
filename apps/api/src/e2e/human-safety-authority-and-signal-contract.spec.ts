import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  HUMAN_SAFETY_ALLOWED_CLOCK_SKEW_MS,
  HUMAN_SAFETY_MAX_SIGNAL_AGE_MS,
  HUMAN_SAFETY_REPLAY_POLICY_VERSION,
  HUMAN_SAFETY_REPLAY_TTL_MS,
  HUMAN_SAFETY_TEMPORAL_POLICY_VERSION,
  acceptHumanSafetySignalEnvelope,
  decideHumanSafetyTransition,
  validateHumanSafetySignalEnvelope,
  type ReplayNonceConsumeRequest,
  type ReplayNonceRegistryPort
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
  assert.equal(allowed.authorityPolicyVersion, 'ros-eye.authority.v3');
  assert.equal(allowed.evaluatedAuthority, 'RESOLVE');
  assert.equal(allowed.authorizedByRole, 'SUPERVISOR');

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

test('authorized role is deterministic and auditable for multi-role actors', () => {
  const result = decideHumanSafetyTransition({
    ...current,
    state: 'CONTACTING' as const,
    severity: 'S2' as const,
    highRiskResolutionAuthorization: null
  }, 'RESPONDED', {
    ...context,
    actorRoles: ['OPERATOR', 'SUPERVISOR'] as const
  });
  assert.equal(result.allowed, true);
  assert.equal(result.authorizedByRole, 'SUPERVISOR');
});

test('auditor and simulated channel fail closed for every operational transition', () => {
  for (const actorRoles of [['AUDITOR'], ['SIMULATED_CHANNEL']] as const) {
    const result = decideHumanSafetyTransition({
      ...current,
      state: 'CONTACTING' as const,
      severity: 'S2' as const,
      highRiskResolutionAuthorization: null
    }, 'RESPONDED', {
      ...context,
      actorRoles
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'actor_not_authorized');
    assert.equal(result.authorizedByRole, null);
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
  assert.equal(result.authorizedByRole, 'OPERATOR');
});

function validPhoneSignal(replayToken = 'replay-token-001') {
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
      replayToken,
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

const tokenDigester = {
  async digest(value: string): Promise<string> {
    return createHash('sha256').update(value).digest('hex');
  }
};

class AtomicMemoryReplayRegistry implements ReplayNonceRegistryPort {
  private readonly consumed = new Set<string>();
  unavailable = false;

  async consume(request: ReplayNonceConsumeRequest) {
    if (this.unavailable) return 'UNAVAILABLE' as const;
    if (Date.parse(request.expiresAt) <= Date.parse('2026-07-27T12:00:02.000Z')) return 'EXPIRED' as const;
    if (this.consumed.has(request.nonceDigest)) return 'DUPLICATE' as const;
    this.consumed.add(request.nonceDigest);
    return 'CONSUMED' as const;
  }
}

test('structural validation cannot emit ACCEPT before replay consume', () => {
  const result = validateHumanSafetySignalEnvelope(validPhoneSignal());
  assert.deepEqual(result, {
    accepted: false,
    disposition: 'HUMAN_REVIEW',
    reasonCode: 'structurally_valid_replay_check_required'
  });
});

test('first replay nonce use is accepted and raw token is not sent to registry', async () => {
  let consumedRequest: ReplayNonceConsumeRequest | undefined;
  const registry: ReplayNonceRegistryPort = {
    async consume(request) {
      consumedRequest = request;
      return 'CONSUMED';
    }
  };
  const signal = validPhoneSignal('raw-secret-replay-token');
  const result = await acceptHumanSafetySignalEnvelope(signal, { replayRegistry: registry, tokenDigester }, '2026-07-27T12:00:02.000Z');
  assert.equal(result.accepted, true);
  assert.equal(result.disposition, 'ACCEPT');
  assert.equal(result.replayPolicyVersion, HUMAN_SAFETY_REPLAY_POLICY_VERSION);
  assert.equal(result.temporalPolicyVersion, HUMAN_SAFETY_TEMPORAL_POLICY_VERSION);
  assert.equal(result.replayConsumeResult, 'CONSUMED');
  assert.match(result.replayScopeDigest ?? '', /^[a-f0-9]{64}$/);
  assert.match(consumedRequest?.nonceDigest ?? '', /^[a-f0-9]{64}$/);
  assert.match(consumedRequest?.scopeDigest ?? '', /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(consumedRequest).includes(signal.integrity.replayToken), false);
});

test('second use is quarantined and concurrent duplicate has exactly one winner', async () => {
  const registry = new AtomicMemoryReplayRegistry();
  const signal = validPhoneSignal();
  const first = await acceptHumanSafetySignalEnvelope(signal, { replayRegistry: registry, tokenDigester }, '2026-07-27T12:00:02.000Z');
  const second = await acceptHumanSafetySignalEnvelope(signal, { replayRegistry: registry, tokenDigester }, '2026-07-27T12:00:02.000Z');
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.disposition, 'QUARANTINE');
  assert.equal(second.reasonCode, 'replay_detected');

  const concurrentRegistry = new AtomicMemoryReplayRegistry();
  const decisions = await Promise.all([
    acceptHumanSafetySignalEnvelope(signal, { replayRegistry: concurrentRegistry, tokenDigester }, '2026-07-27T12:00:02.000Z'),
    acceptHumanSafetySignalEnvelope(signal, { replayRegistry: concurrentRegistry, tokenDigester }, '2026-07-27T12:00:02.000Z')
  ]);
  assert.equal(decisions.filter((decision) => decision.accepted).length, 1);
  assert.equal(decisions.filter((decision) => decision.reasonCode === 'replay_detected').length, 1);
});

test('same replay nonce is rejected across different signal and source scopes', async () => {
  const sharedToken = 'shared-cross-scope-nonce';

  for (const alteredSignal of [
    { ...validPhoneSignal(sharedToken), signalId: 'signal-002' },
    { ...validPhoneSignal(sharedToken), sourceId: 'device-pseudonym-002' }
  ]) {
    const registry = new AtomicMemoryReplayRegistry();
    const first = await acceptHumanSafetySignalEnvelope(validPhoneSignal(sharedToken), { replayRegistry: registry, tokenDigester }, '2026-07-27T12:00:02.000Z');
    const replayed = await acceptHumanSafetySignalEnvelope(alteredSignal, { replayRegistry: registry, tokenDigester }, '2026-07-27T12:00:02.000Z');
    assert.equal(first.accepted, true);
    assert.equal(replayed.accepted, false);
    assert.equal(replayed.reasonCode, 'replay_detected');
  }

  const concurrentRegistry = new AtomicMemoryReplayRegistry();
  const concurrent = await Promise.all([
    acceptHumanSafetySignalEnvelope(validPhoneSignal(sharedToken), { replayRegistry: concurrentRegistry, tokenDigester }, '2026-07-27T12:00:02.000Z'),
    acceptHumanSafetySignalEnvelope({ ...validPhoneSignal(sharedToken), signalId: 'signal-003' }, { replayRegistry: concurrentRegistry, tokenDigester }, '2026-07-27T12:00:02.000Z')
  ]);
  assert.equal(concurrent.filter((decision) => decision.accepted).length, 1);
  assert.equal(concurrent.filter((decision) => decision.reasonCode === 'replay_detected').length, 1);
});

test('registry unavailable or throwing never produces ACCEPT', async () => {
  const unavailable = new AtomicMemoryReplayRegistry();
  unavailable.unavailable = true;
  const unavailableResult = await acceptHumanSafetySignalEnvelope(validPhoneSignal(), { replayRegistry: unavailable, tokenDigester }, '2026-07-27T12:00:02.000Z');
  assert.equal(unavailableResult.accepted, false);
  assert.equal(unavailableResult.disposition, 'HUMAN_REVIEW');
  assert.equal(unavailableResult.reasonCode, 'replay_registry_unavailable');

  const throwing: ReplayNonceRegistryPort = { async consume() { throw new Error('timeout'); } };
  const thrownResult = await acceptHumanSafetySignalEnvelope(validPhoneSignal(), { replayRegistry: throwing, tokenDigester }, '2026-07-27T12:00:02.000Z');
  assert.equal(thrownResult.accepted, false);
  assert.equal(thrownResult.reasonCode, 'replay_registry_unavailable');
});

test('expired token is quarantined before registry consume', async () => {
  let calls = 0;
  const registry: ReplayNonceRegistryPort = { async consume() { calls += 1; return 'CONSUMED'; } };
  const result = await acceptHumanSafetySignalEnvelope(validPhoneSignal(), { replayRegistry: registry, tokenDigester }, '2026-07-27T12:16:00.000Z');
  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'replay_token_expired');
  assert.equal(calls, 0);
});

test('future and stale timestamps fail closed using trusted evaluation time', async () => {
  let calls = 0;
  const registry: ReplayNonceRegistryPort = { async consume() { calls += 1; return 'CONSUMED'; } };
  const evaluatedAt = '2026-07-27T12:00:02.000Z';
  const evaluatedAtMs = Date.parse(evaluatedAt);

  const beyondSkewAt = new Date(evaluatedAtMs + HUMAN_SAFETY_ALLOWED_CLOCK_SKEW_MS + 1).toISOString();
  const future = await acceptHumanSafetySignalEnvelope({
    ...validPhoneSignal('future-nonce'),
    occurredAt: beyondSkewAt,
    receivedAt: beyondSkewAt
  }, { replayRegistry: registry, tokenDigester }, evaluatedAt);
  assert.equal(future.accepted, false);
  assert.equal(future.disposition, 'QUARANTINE');
  assert.equal(future.reasonCode, 'signal_timestamp_in_future');

  const staleOccurredAt = new Date(evaluatedAtMs - HUMAN_SAFETY_MAX_SIGNAL_AGE_MS - 1).toISOString();
  const stale = await acceptHumanSafetySignalEnvelope({
    ...validPhoneSignal('stale-nonce'),
    occurredAt: staleOccurredAt,
    receivedAt: new Date(evaluatedAtMs - HUMAN_SAFETY_MAX_SIGNAL_AGE_MS).toISOString()
  }, { replayRegistry: registry, tokenDigester }, evaluatedAt);
  assert.equal(stale.accepted, false);
  assert.equal(stale.disposition, 'HUMAN_REVIEW');
  assert.equal(stale.reasonCode, 'stale_signal_requires_human_review');
  assert.equal(calls, 0);
});

test('allowed skew boundary is deterministic and cannot extend replay expiry', async () => {
  let consumedRequest: ReplayNonceConsumeRequest | undefined;
  const registry: ReplayNonceRegistryPort = {
    async consume(request) {
      consumedRequest = request;
      return 'CONSUMED';
    }
  };
  const evaluatedAt = '2026-07-27T12:00:02.000Z';
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const boundary = new Date(evaluatedAtMs + HUMAN_SAFETY_ALLOWED_CLOCK_SKEW_MS).toISOString();
  const result = await acceptHumanSafetySignalEnvelope({
    ...validPhoneSignal('bounded-future-nonce'),
    occurredAt: evaluatedAt,
    receivedAt: boundary,
    integrity: {
      ...validPhoneSignal().integrity,
      replayToken: 'bounded-future-nonce',
      clockSkewMs: HUMAN_SAFETY_ALLOWED_CLOCK_SKEW_MS
    }
  }, { replayRegistry: registry, tokenDigester }, evaluatedAt);

  const expectedExpiry = new Date(evaluatedAtMs + HUMAN_SAFETY_REPLAY_TTL_MS).toISOString();
  assert.equal(result.accepted, true);
  assert.equal(result.temporalPolicyVersion, HUMAN_SAFETY_TEMPORAL_POLICY_VERSION);
  assert.equal(result.replayExpiresAt, expectedExpiry);
  assert.equal(consumedRequest?.expiresAt, expectedExpiry);
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
  const result = validateHumanSafetySignalEnvelope({ ...signal, sourceType: 'VEHICLE' });
  assert.equal(result.disposition, 'HUMAN_REVIEW');
  assert.equal(result.reasonCode, 'source_payload_mismatch');
});

test('invalid signatures, identifiers, chronology and semantic values fail closed', () => {
  const signal = validPhoneSignal();
  const candidates = [
    { ...signal, signalId: '!' },
    { ...signal, occurredAt: 'not-a-date' },
    { ...signal, occurredAt: '2026-07-27T12:01:00.000Z', receivedAt: '2026-07-27T12:00:00.000Z' },
    { ...signal, integrity: { ...signal.integrity, signatureStatus: 'INVALID' } },
    { ...signal, integrity: { ...signal.integrity, signatureStatus: 'UNKNOWN' } },
    { ...signal, integrity: { ...signal.integrity, replayToken: '  ' } },
    { ...signal, payload: { ...signal.payload, accelerationMagnitude: Number.NaN } },
    { ...signal, location: { latitude: 91, longitude: 46.6, accuracyMeters: 1, classification: 'PRECISE_RESTRICTED' } },
    { ...signal, sourceType: 'PERSON', payload: { kind: 'PERSON_REPORT', indicatorCodes: ['UNKNOWN_INDICATOR'] } }
  ];
  for (const candidate of candidates) {
    const result = validateHumanSafetySignalEnvelope(candidate);
    assert.equal(result.accepted, false);
    assert.equal(result.disposition, 'QUARANTINE');
  }
});

test('unverified signature and excessive clock skew require human review', () => {
  const signal = validPhoneSignal();
  const unverified = validateHumanSafetySignalEnvelope({ ...signal, integrity: { ...signal.integrity, signatureStatus: 'UNVERIFIED' } });
  assert.equal(unverified.disposition, 'HUMAN_REVIEW');

  const skewed = validateHumanSafetySignalEnvelope({ ...signal, integrity: { ...signal.integrity, clockSkewMs: HUMAN_SAFETY_ALLOWED_CLOCK_SKEW_MS + 1 } });
  assert.equal(skewed.disposition, 'HUMAN_REVIEW');
  assert.equal(skewed.reasonCode, 'clock_skew_exceeded');
});

test('purpose, consent, classification and retention must remain coherent', () => {
  const signal = validPhoneSignal();
  for (const candidate of [
    { ...signal, consentBasis: 'SIMULATION' },
    { ...signal, dataClassification: 'OPERATIONAL' },
    { ...signal, retentionClass: 'SIMULATION_ONLY' }
  ]) {
    const result = validateHumanSafetySignalEnvelope(candidate);
    assert.equal(result.reasonCode, 'purpose_classification_mismatch');
  }
});
