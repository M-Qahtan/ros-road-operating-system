import assert from 'node:assert/strict';
import {
  HUMAN_SAFETY_MAX_SIGNAL_AGE_MS,
  HUMAN_SAFETY_REPLAY_POLICY_VERSION,
  acceptHumanSafetySignalEnvelope,
  type HumanSafetySignalAcceptancePorts,
  type ReplayNonceConsumeResult
} from './human-safety.js';

const now = '2026-10-03T20:00:00.000Z';
const digest = 'a'.repeat(64);

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    signalId: 'sig-001',
    schemaVersion: 'ros-eye.signal.v1',
    purposePolicyVersion: 'ros-eye.purpose.v1',
    dataClassification: 'OPERATIONAL',
    retentionClass: 'SIMULATION_ONLY',
    sourceType: 'SIMULATION',
    sourceId: 'sim-source-001',
    occurredAt: now,
    receivedAt: now,
    consentBasis: 'SIMULATION',
    integrity: { replayToken: 'nonce-001', signatureStatus: 'VERIFIED', clockSkewMs: 0 },
    location: null,
    payload: { kind: 'SIMULATION_FIXTURE', fixtureId: 'fixture-001' },
    ...overrides
  };
}

function ports(result: ReplayNonceConsumeResult = 'CONSUMED'): HumanSafetySignalAcceptancePorts {
  return {
    tokenDigester: { digest: async () => digest },
    replayRegistry: { consume: async request => {
      assert.equal(request.policyVersion, HUMAN_SAFETY_REPLAY_POLICY_VERSION);
      return result;
    }}
  };
}

{
  const decision = await acceptHumanSafetySignalEnvelope(envelope(), ports(), now);
  assert.equal(decision.accepted, true);
  assert.equal(decision.disposition, 'ACCEPT');
  assert.equal(decision.replayConsumeResult, 'CONSUMED');
}

{
  const decision = await acceptHumanSafetySignalEnvelope(envelope(), ports('DUPLICATE'), now);
  assert.equal(decision.accepted, false);
  assert.equal(decision.disposition, 'QUARANTINE');
  assert.equal(decision.reasonCode, 'replay_detected');
}

{
  const decision = await acceptHumanSafetySignalEnvelope(envelope(), ports('UNAVAILABLE'), now);
  assert.equal(decision.accepted, false);
  assert.equal(decision.disposition, 'HUMAN_REVIEW');
  assert.equal(decision.reasonCode, 'replay_registry_unavailable');
}

{
  const staleAt = new Date(Date.parse(now) - HUMAN_SAFETY_MAX_SIGNAL_AGE_MS - 1).toISOString();
  const decision = await acceptHumanSafetySignalEnvelope(
    envelope({ occurredAt: staleAt, receivedAt: staleAt }),
    ports(),
    now
  );
  assert.equal(decision.accepted, false);
  assert.equal(decision.disposition, 'HUMAN_REVIEW');
  assert.equal(decision.reasonCode, 'stale_signal_requires_human_review');
}

{
  const decision = await acceptHumanSafetySignalEnvelope(
    envelope({ integrity: { replayToken: 'nonce-001', signatureStatus: 'INVALID', clockSkewMs: 0 } }),
    ports(),
    now
  );
  assert.equal(decision.accepted, false);
  assert.equal(decision.disposition, 'QUARANTINE');
  assert.equal(decision.reasonCode, 'invalid_signature');
}

console.log('human-safety executable gate: PASS');
