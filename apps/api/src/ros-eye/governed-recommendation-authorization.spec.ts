import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrustedIntegrationPrincipal } from '../integrations/integration-principal.js';
import type { ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import {
  POSTGRES_GOVERNED_RECOMMENDATION_AUTHORIZATION_SQL,
  PostgresTrustedActorRecommendationAuthorization
} from './governed-recommendation-authorization.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'TRAFFIC_COORDINATION', caseId: CASE_ID } as const;
const PRINCIPAL: TrustedIntegrationPrincipal = {
  subject: '22222222-2222-4222-8222-222222222222', clientId: 'operator-console',
  tenantId: SCOPE.tenantId, purpose: SCOPE.purpose, mfaVerified: true, roles: ['OPERATOR'],
  issuedAt: '2026-09-08T17:59:00.000Z', expiresAt: '2026-09-08T18:05:00.000Z'
};

class Pool implements ContactSqlPoolPort {
  calls = 0;
  rows: readonly ContactSqlRow[] = [{ case_id: CASE_ID }];
  async transaction<T>(work: (connection: Pool) => Promise<T>): Promise<T> { return work(this); }
  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    assert.equal(text, POSTGRES_GOVERNED_RECOMMENDATION_AUTHORIZATION_SQL);
    assert.deepEqual(values, [SCOPE.tenantId, SCOPE.purpose, CASE_ID]);
    this.calls += 1;
    return { rows: this.rows as readonly Row[], rowCount: this.rows.length };
  }
}

test('mints only an exact case-scoped capability bounded by the verified OIDC session', async () => {
  const pool = new Pool();
  const receipt = await new PostgresTrustedActorRecommendationAuthorization(pool, PRINCIPAL)
    .authorize({ actorId: PRINCIPAL.subject }, SCOPE);
  assert.deepEqual(receipt, {
    ...SCOPE, actorId: PRINCIPAL.subject, permission: 'EVALUATE_AND_RECORD_RECOMMENDATION', status: 'ACTIVE',
    policyVersion: 'ros-eye.governed-recommendation.authorization.v1',
    issuedAt: PRINCIPAL.issuedAt, expiresAt: PRINCIPAL.expiresAt
  });
  assert.equal(pool.calls, 1);
});

test('identity, tenant, purpose, MFA and human-role drift deny before database access', async () => {
  const variants: Array<[TrustedIntegrationPrincipal, { actorId: string }, typeof SCOPE]> = [
    [PRINCIPAL, { actorId: '33333333-3333-4333-8333-333333333333' }, SCOPE],
    [{ ...PRINCIPAL, tenantId: 'tenant-other' }, { actorId: PRINCIPAL.subject }, SCOPE],
    [{ ...PRINCIPAL, purpose: 'INCIDENT_TRIAGE' }, { actorId: PRINCIPAL.subject }, SCOPE],
    [{ ...PRINCIPAL, mfaVerified: false }, { actorId: PRINCIPAL.subject }, SCOPE],
    [{ ...PRINCIPAL, roles: ['AUDITOR'] }, { actorId: PRINCIPAL.subject }, SCOPE]
  ];
  for (const [principal, actor, scope] of variants) {
    const pool = new Pool();
    assert.equal(await new PostgresTrustedActorRecommendationAuthorization(pool, principal).authorize(actor, scope), null);
    assert.equal(pool.calls, 0);
  }
});

test('missing or ambiguous case ownership fails closed', async () => {
  for (const rows of [[], [{ case_id: CASE_ID }, { case_id: CASE_ID }]]) {
    const pool = new Pool();
    pool.rows = rows;
    assert.equal(await new PostgresTrustedActorRecommendationAuthorization(pool, PRINCIPAL)
      .authorize({ actorId: PRINCIPAL.subject }, SCOPE), null);
  }
});
