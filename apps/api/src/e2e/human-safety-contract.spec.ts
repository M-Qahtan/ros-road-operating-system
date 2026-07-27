import assert from 'node:assert/strict';
import test from 'node:test';
import { decideHumanSafetyTransition } from '@ros/contracts';

const CASE_ID = '92000000-0000-4000-8000-000000000001';
const SUPERVISOR_ID = '92000000-0000-4000-8000-000000000011';

const baseCase = {
  id: CASE_ID,
  version: 7,
  severityAssessmentVersion: 3,
  evidenceRevision: 4,
  indicatorRevision: 5
} as const;

const baseContext = {
  actorId: '92000000-0000-4000-8000-000000000010',
  actorRoles: ['OPERATOR'] as const,
  reason: 'contract verification',
  traceId: 'ros-eye-contract-test',
  occurredAt: '2026-07-27T04:10:00.000Z',
  connectivity: 'HEALTHY' as const,
  evidenceQuality: 'TRUSTED' as const,
  dependenciesHealthy: true
};

function authorizedCase() {
  return {
    ...baseCase,
    state: 'MONITORED' as const,
    severity: 'S3' as const,
    highRiskResolutionAuthorization: {
      caseId: CASE_ID,
      decision: 'RESOLVE' as const,
      actorId: SUPERVISOR_ID,
      role: 'SUPERVISOR' as const,
      reason: 'Human safety verified and residual uncertainty reviewed',
      authorizedAt: '2026-07-27T04:05:00.000Z',
      expiresAt: '2026-07-27T04:15:00.000Z',
      caseVersion: baseCase.version,
      severityAssessmentVersion: baseCase.severityAssessmentVersion,
      evidenceRevision: baseCase.evidenceRevision,
      indicatorRevision: baseCase.indicatorRevision,
      connectivity: 'HEALTHY' as const,
      dependenciesHealthy: true
    }
  };
}

test('conflicting evidence cannot resolve a human safety case', () => {
  const result = decideHumanSafetyTransition({ ...baseCase, state: 'MONITORED', severity: 'S2', highRiskResolutionAuthorization: null }, 'RESOLVED', {
    ...baseContext,
    evidenceQuality: 'CONFLICTING'
  });
  assert.equal(result.allowed, false);
  assert.equal(result.nextState, 'HUMAN_REVIEW');
  assert.equal(result.failureBehavior, 'HUMAN_REVIEW');
});

test('connectivity loss escalates instead of silently progressing', () => {
  const result = decideHumanSafetyTransition({ ...baseCase, state: 'CONTACTING', severity: 'S3', highRiskResolutionAuthorization: null }, 'RESPONDED', {
    ...baseContext,
    connectivity: 'LOST'
  });
  assert.equal(result.allowed, false);
  assert.equal(result.nextState, 'ESCALATED');
  assert.equal(result.failureBehavior, 'ESCALATE');
});

test('unhealthy dependencies block resolution', () => {
  const result = decideHumanSafetyTransition({ ...baseCase, state: 'MONITORED', severity: 'S1', highRiskResolutionAuthorization: null }, 'RESOLVED', {
    ...baseContext,
    dependenciesHealthy: false
  });
  assert.equal(result.allowed, false);
  assert.equal(result.nextState, 'ESCALATED');
});

test('S3 resolution requires recorded, current human authority', () => {
  const denied = decideHumanSafetyTransition({ ...baseCase, state: 'MONITORED', severity: 'S3', highRiskResolutionAuthorization: null }, 'RESOLVED', baseContext);
  assert.equal(denied.allowed, false);
  assert.equal(denied.requiredAuthority, 'AUTHORIZE_HIGH_RISK_RESOLUTION');

  const allowed = decideHumanSafetyTransition(authorizedCase(), 'RESOLVED', {
    ...baseContext,
    actorId: SUPERVISOR_ID,
    actorRoles: ['SUPERVISOR'] as const
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.nextState, 'RESOLVED');
});

test('new evidence invalidates a prior high-risk resolution authorization', () => {
  const current = authorizedCase();
  const result = decideHumanSafetyTransition({ ...current, evidenceRevision: current.evidenceRevision + 1 }, 'RESOLVED', {
    ...baseContext,
    actorId: SUPERVISOR_ID,
    actorRoles: ['SUPERVISOR'] as const
  });
  assert.equal(result.allowed, false);
  assert.equal(result.nextState, 'HUMAN_REVIEW');
  assert.equal(result.reasonCode, 'stale_or_invalid_authorization');
});

test('severity reassessment invalidates a prior high-risk resolution authorization', () => {
  const current = authorizedCase();
  const result = decideHumanSafetyTransition({ ...current, severityAssessmentVersion: current.severityAssessmentVersion + 1 }, 'RESOLVED', {
    ...baseContext,
    actorId: SUPERVISOR_ID,
    actorRoles: ['SAFETY_LEAD'] as const
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'stale_or_invalid_authorization');
});

test('expired or cross-case authorization is rejected', () => {
  const current = authorizedCase();
  const expired = decideHumanSafetyTransition(current, 'RESOLVED', {
    ...baseContext,
    actorId: SUPERVISOR_ID,
    actorRoles: ['SUPERVISOR'] as const,
    occurredAt: '2026-07-27T04:16:00.000Z'
  });
  assert.equal(expired.allowed, false);
  assert.equal(expired.reasonCode, 'stale_or_invalid_authorization');

  const wrongCase = decideHumanSafetyTransition({
    ...current,
    highRiskResolutionAuthorization: { ...current.highRiskResolutionAuthorization, caseId: 'another-case' }
  }, 'RESOLVED', {
    ...baseContext,
    actorId: SUPERVISOR_ID,
    actorRoles: ['SUPERVISOR'] as const
  });
  assert.equal(wrongCase.allowed, false);
});

test('connectivity or dependency state changes invalidate authorization', () => {
  const current = authorizedCase();
  const degraded = decideHumanSafetyTransition(current, 'RESOLVED', {
    ...baseContext,
    actorId: SUPERVISOR_ID,
    actorRoles: ['SUPERVISOR'] as const,
    connectivity: 'DEGRADED'
  });
  assert.equal(degraded.allowed, false);
  assert.equal(degraded.reasonCode, 'stale_or_invalid_authorization');
});

test('invalid lifecycle jumps are rejected', () => {
  const result = decideHumanSafetyTransition({ ...baseCase, state: 'UNKNOWN', severity: 'S0', highRiskResolutionAuthorization: null }, 'RESOLVED', baseContext);
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'invalid_transition');
});
