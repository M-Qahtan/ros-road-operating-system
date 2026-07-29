import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HUMAN_SAFETY_UNCERTAINTY_POLICY_VERSION,
  decideHumanSafetyTransition
} from '@ros/contracts';

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

function resolvedCase() {
  const current = authorizedCase();
  return { ...current, state: 'RESOLVED' as const, version: current.version + 1 };
}

const supervisorContext = {
  ...baseContext,
  actorId: SUPERVISOR_ID,
  actorRoles: ['SUPERVISOR'] as const
};

function uncertaintyAuthorization(evidenceQuality: 'AMBIGUOUS' | 'CONFLICTING' | 'MISSING') {
  const reasonCode: 'AMBIGUITY_RESOLVED' | 'CONFLICT_RESOLVED' | 'MISSING_EVIDENCE_DISPOSITIONED' = evidenceQuality === 'AMBIGUOUS'
    ? 'AMBIGUITY_RESOLVED'
    : evidenceQuality === 'CONFLICTING'
      ? 'CONFLICT_RESOLVED'
      : 'MISSING_EVIDENCE_DISPOSITIONED';
  return {
    caseId: CASE_ID,
    decision: 'ALLOW_MONITORING' as const,
    actorId: SUPERVISOR_ID,
    role: 'SUPERVISOR' as const,
    reasonCode,
    policyVersion: HUMAN_SAFETY_UNCERTAINTY_POLICY_VERSION,
    authorizedAt: '2026-07-27T04:05:00.000Z',
    expiresAt: '2026-07-27T04:15:00.000Z',
    caseVersion: baseCase.version,
    severityAssessmentVersion: baseCase.severityAssessmentVersion,
    evidenceRevision: baseCase.evidenceRevision,
    indicatorRevision: baseCase.indicatorRevision,
    resolvedEvidenceQuality: evidenceQuality
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
  assert.equal(result.reasonCode, 'dependencies_unhealthy');
});

test('unresolved evidence blocks every active-review de-escalation to monitored', () => {
  for (const state of ['HUMAN_REVIEW', 'ESCALATED', 'TRANSFERRED'] as const) {
    for (const evidenceQuality of ['AMBIGUOUS', 'CONFLICTING', 'MISSING'] as const) {
      const result = decideHumanSafetyTransition({
        ...baseCase,
        state,
        severity: 'S2' as const,
        highRiskResolutionAuthorization: null
      }, 'MONITORED', {
        ...supervisorContext,
        evidenceQuality
      });
      assert.equal(result.allowed, false, `${state}/${evidenceQuality}`);
      assert.notEqual(result.nextState, 'MONITORED');
      assert.equal(result.reasonCode, 'unresolved_evidence_requires_versioned_authorization');
    }
  }
});

test('unhealthy dependencies block every active-review de-escalation even with an uncertainty authorization', () => {
  for (const state of ['HUMAN_REVIEW', 'ESCALATED', 'TRANSFERRED'] as const) {
    const result = decideHumanSafetyTransition({
      ...baseCase,
      state,
      severity: 'S2' as const,
      highRiskResolutionAuthorization: null
    }, 'MONITORED', {
      ...supervisorContext,
      evidenceQuality: 'AMBIGUOUS',
      dependenciesHealthy: false,
      uncertaintyResolutionAuthorization: uncertaintyAuthorization('AMBIGUOUS')
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'dependencies_unhealthy');
  }
});

test('version-bound human uncertainty resolution may allow monitoring after dependencies recover', () => {
  const result = decideHumanSafetyTransition({
    ...baseCase,
    state: 'HUMAN_REVIEW' as const,
    severity: 'S2' as const,
    highRiskResolutionAuthorization: null
  }, 'MONITORED', {
    ...supervisorContext,
    evidenceQuality: 'CONFLICTING',
    uncertaintyResolutionAuthorization: uncertaintyAuthorization('CONFLICTING')
  });
  assert.equal(result.allowed, true);
  assert.equal(result.authorizedByRole, 'SUPERVISOR');
});

test('stale, mismatched, future or expired uncertainty authorization fails closed', () => {
  const current = {
    ...baseCase,
    state: 'HUMAN_REVIEW' as const,
    severity: 'S2' as const,
    highRiskResolutionAuthorization: null
  };
  const authorization = uncertaintyAuthorization('AMBIGUOUS');
  const invalid = [
    { ...authorization, evidenceRevision: authorization.evidenceRevision + 1 },
    { ...authorization, indicatorRevision: authorization.indicatorRevision + 1 },
    { ...authorization, resolvedEvidenceQuality: 'MISSING' as const },
    { ...authorization, authorizedAt: '2026-07-27T04:11:00.000Z' },
    { ...authorization, expiresAt: '2026-07-27T04:09:00.000Z' }
  ];
  for (const uncertaintyResolutionAuthorization of invalid) {
    const result = decideHumanSafetyTransition(current, 'MONITORED', {
      ...supervisorContext,
      evidenceQuality: 'AMBIGUOUS',
      uncertaintyResolutionAuthorization
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'unresolved_evidence_requires_versioned_authorization');
  }
});

test('S3 resolution requires recorded, current human authority', () => {
  const denied = decideHumanSafetyTransition({ ...baseCase, state: 'MONITORED', severity: 'S3', highRiskResolutionAuthorization: null }, 'RESOLVED', baseContext);
  assert.equal(denied.allowed, false);
  assert.equal(denied.requiredAuthority, 'AUTHORIZE_HIGH_RISK_RESOLUTION');

  const allowed = decideHumanSafetyTransition(authorizedCase(), 'RESOLVED', supervisorContext);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.nextState, 'RESOLVED');
  assert.equal(allowed.authorizedByRole, 'SUPERVISOR');
});

test('new evidence or severity reassessment invalidates prior high-risk authorization', () => {
  const current = authorizedCase();
  for (const candidate of [
    { ...current, evidenceRevision: current.evidenceRevision + 1 },
    { ...current, indicatorRevision: current.indicatorRevision + 1 },
    { ...current, severityAssessmentVersion: current.severityAssessmentVersion + 1 }
  ]) {
    const result = decideHumanSafetyTransition(candidate, 'RESOLVED', supervisorContext);
    assert.equal(result.allowed, false);
    assert.equal(result.nextState, 'HUMAN_REVIEW');
    assert.equal(result.reasonCode, 'stale_or_invalid_authorization');
  }
});

test('expired, future-dated, malformed or cross-case authorization is rejected', () => {
  const current = authorizedCase();
  const candidates = [
    { context: { ...supervisorContext, occurredAt: '2026-07-27T04:16:00.000Z' }, authorization: current.highRiskResolutionAuthorization },
    { context: supervisorContext, authorization: { ...current.highRiskResolutionAuthorization, caseId: 'another-case' } },
    { context: supervisorContext, authorization: { ...current.highRiskResolutionAuthorization, authorizedAt: '2026-07-27T04:11:00.000Z', expiresAt: '2026-07-27T04:20:00.000Z' } },
    { context: supervisorContext, authorization: { ...current.highRiskResolutionAuthorization, authorizedAt: 'not-a-date' } },
    { context: supervisorContext, authorization: { ...current.highRiskResolutionAuthorization, expiresAt: 'not-a-date' } },
    { context: supervisorContext, authorization: { ...current.highRiskResolutionAuthorization, authorizedAt: '2026-07-27T04:15:00.000Z', expiresAt: '2026-07-27T04:15:00.000Z' } }
  ];
  for (const candidate of candidates) {
    const result = decideHumanSafetyTransition({ ...current, highRiskResolutionAuthorization: candidate.authorization }, 'RESOLVED', candidate.context);
    assert.equal(result.allowed, false);
  }
});

test('invalid transition occurrence timestamp fails closed', () => {
  const result = decideHumanSafetyTransition(authorizedCase(), 'RESOLVED', {
    ...supervisorContext,
    occurredAt: 'invalid-transition-time'
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'invalid_transition_context');
});

test('connectivity or dependency state changes invalidate high-risk authorization', () => {
  const current = authorizedCase();
  const degraded = decideHumanSafetyTransition(current, 'RESOLVED', {
    ...supervisorContext,
    connectivity: 'DEGRADED'
  });
  assert.equal(degraded.allowed, false);
  assert.equal(degraded.reasonCode, 'stale_or_invalid_authorization');
});

test('late high-risk signal reactivates resolved case with prior authorization explicitly invalidated', () => {
  const result = decideHumanSafetyTransition(resolvedCase(), 'ESCALATED', {
    ...baseContext,
    reactivationCause: 'LATE_HIGH_RISK_SIGNAL'
  });
  assert.equal(result.allowed, true);
  assert.equal(result.nextState, 'ESCALATED');
  assert.equal(result.auditAction, 'human_safety.resolved_case_escalated');
  assert.equal(result.reasonCode, 'reactivated_late_high_risk_signal_prior_authorization_invalidated');
});

test('contradictory indicator reopens resolved case only for human review', () => {
  const result = decideHumanSafetyTransition(resolvedCase(), 'HUMAN_REVIEW', {
    ...baseContext,
    evidenceQuality: 'CONFLICTING',
    reactivationCause: 'CONTRADICTORY_INDICATOR'
  });
  assert.equal(result.allowed, true);
  assert.equal(result.nextState, 'HUMAN_REVIEW');
  assert.equal(result.auditAction, 'human_safety.resolved_case_reopened_for_review');
});

test('reactivation requires classified cause and invalidates prior authorization', () => {
  const denied = decideHumanSafetyTransition(resolvedCase(), 'HUMAN_REVIEW', baseContext);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reasonCode, 'reactivation_cause_required');

  const allowed = decideHumanSafetyTransition(resolvedCase(), 'HUMAN_REVIEW', {
    ...baseContext,
    reactivationCause: 'EVIDENCE_CORRECTION'
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reasonCode, 'reactivated_evidence_correction_prior_authorization_invalidated');
});

test('resolved case cannot silently return to ordinary lifecycle state', () => {
  const result = decideHumanSafetyTransition(resolvedCase(), 'MONITORED', {
    ...baseContext,
    reactivationCause: 'DEPENDENCY_RECOVERY_FINDING'
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'invalid_transition');
});

test('reactivation does not make prior resolution authorization current again', () => {
  const reactivated = resolvedCase();
  const result = decideHumanSafetyTransition({
    ...reactivated,
    state: 'MONITORED',
    version: reactivated.version + 1
  }, 'RESOLVED', supervisorContext);
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'stale_or_invalid_authorization');
});

test('invalid lifecycle jumps are rejected', () => {
  const result = decideHumanSafetyTransition({ ...baseCase, state: 'UNKNOWN', severity: 'S0', highRiskResolutionAuthorization: null }, 'RESOLVED', baseContext);
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'invalid_transition');
});
