import assert from 'node:assert/strict';
import test from 'node:test';
import { decideHumanSafetyTransition } from '@ros/contracts';

const baseContext = {
  actorId: '92000000-0000-4000-8000-000000000010',
  actorRoles: ['OPERATOR'] as const,
  reason: 'contract verification',
  traceId: 'ros-eye-contract-test',
  occurredAt: '2026-07-27T04:00:00.000Z',
  connectivity: 'HEALTHY' as const,
  evidenceQuality: 'TRUSTED' as const,
  dependenciesHealthy: true
};

test('conflicting evidence cannot resolve a human safety case', () => {
  const result = decideHumanSafetyTransition({ state: 'MONITORED', severity: 'S2', highRiskResolutionAuthorization: null }, 'RESOLVED', {
    ...baseContext,
    evidenceQuality: 'CONFLICTING'
  });
  assert.equal(result.allowed, false);
  assert.equal(result.nextState, 'HUMAN_REVIEW');
  assert.equal(result.failureBehavior, 'HUMAN_REVIEW');
});

test('connectivity loss escalates instead of silently progressing', () => {
  const result = decideHumanSafetyTransition({ state: 'CONTACTING', severity: 'S3', highRiskResolutionAuthorization: null }, 'RESPONDED', {
    ...baseContext,
    connectivity: 'LOST'
  });
  assert.equal(result.allowed, false);
  assert.equal(result.nextState, 'ESCALATED');
  assert.equal(result.failureBehavior, 'ESCALATE');
});

test('unhealthy dependencies block resolution', () => {
  const result = decideHumanSafetyTransition({ state: 'MONITORED', severity: 'S1', highRiskResolutionAuthorization: null }, 'RESOLVED', {
    ...baseContext,
    dependenciesHealthy: false
  });
  assert.equal(result.allowed, false);
  assert.equal(result.nextState, 'ESCALATED');
});

test('S3 resolution requires recorded human authority', () => {
  const denied = decideHumanSafetyTransition({ state: 'MONITORED', severity: 'S3', highRiskResolutionAuthorization: null }, 'RESOLVED', baseContext);
  assert.equal(denied.allowed, false);
  assert.equal(denied.requiredAuthority, 'AUTHORIZE_HIGH_RISK_RESOLUTION');

  const allowed = decideHumanSafetyTransition({
    state: 'MONITORED',
    severity: 'S3',
    highRiskResolutionAuthorization: {
      actorId: '92000000-0000-4000-8000-000000000011',
      role: 'SUPERVISOR',
      reason: 'Human safety verified and residual uncertainty reviewed',
      authorizedAt: '2026-07-27T04:05:00.000Z'
    }
  }, 'RESOLVED', {
    ...baseContext,
    actorId: '92000000-0000-4000-8000-000000000011',
    actorRoles: ['SUPERVISOR'] as const
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.nextState, 'RESOLVED');
});

test('invalid lifecycle jumps are rejected', () => {
  const result = decideHumanSafetyTransition({ state: 'UNKNOWN', severity: 'S0', highRiskResolutionAuthorization: null }, 'RESOLVED', baseContext);
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'invalid_transition');
});
