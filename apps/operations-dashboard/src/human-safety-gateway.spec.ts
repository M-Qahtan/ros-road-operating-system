import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandCenterRequestError, HttpHumanSafetyCommandCenterGateway } from './human-safety-gateway.js';

const session = {
  tenantId: 'riyadh-pilot',
  purpose: 'HUMAN_SAFETY_RESPONSE',
  getAccessToken: () => Promise.resolve('signed-human-safety-token')
};

function response(status: number, data: unknown, error: unknown = null): Response {
  return new Response(JSON.stringify({
    success: status >= 200 && status < 300,
    data,
    error,
    traceId: 'trace-human-safety-001'
  }), { status, headers: { 'content-type': 'application/json' } });
}

test('Human Safety browser uses Bearer and exact action routes without self-asserted identity headers', async () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    return response(200, String(input).includes('?')
      ? { items: [], generatedAt: '2026-08-20T10:00:00.000Z', simulation: false }
      : { safetyCase: { id: 'case-001' } });
  };
  const gateway = new HttpHumanSafetyCommandCenterGateway('', session, fetcher);
  const action = {
    actorId: 'attacker-supplied-actor',
    actorRoles: ['SAFETY_LEAD'] as const,
    expectedCaseVersion: 3,
    expectedContactVersion: 2,
    reason: 'قرار بشري موثق',
    traceId: 'trace-action-001',
    occurredAt: '2026-08-20T10:00:00.000Z',
    idempotencyKey: 'idem-action-001'
  };

  await gateway.list();
  await gateway.get('case/unsafe');
  await gateway.takeover('case-001', action);
  await gateway.escalate('case-001', action);
  await gateway.reassign('case-001', { ...action, assigneeId: 'operator-2' });
  await gateway.authorizeResolution('case-001', action);

  assert.deepEqual(requests.map((item) => item.url), [
    '/api/v1/human-safety/cases?limit=100&offset=0',
    '/api/v1/human-safety/cases/case%2Funsafe',
    '/api/v1/human-safety/cases/case-001/takeover',
    '/api/v1/human-safety/cases/case-001/escalate',
    '/api/v1/human-safety/cases/case-001/assignment',
    '/api/v1/human-safety/cases/case-001/resolution-authorization'
  ]);
  for (const item of requests) {
    const headers = new Headers(item.init.headers);
    assert.equal(headers.get('authorization'), 'Bearer signed-human-safety-token');
    assert.equal(headers.get('x-tenant-id'), 'riyadh-pilot');
    assert.equal(headers.get('x-purpose'), 'HUMAN_SAFETY_RESPONSE');
    assert.equal(headers.has('x-actor-id'), false);
    assert.equal(headers.has('x-ros-eye-roles'), false);
  }
  for (const item of requests.slice(2)) {
    assert.equal(new Headers(item.init.headers).get('idempotency-key'), 'idem-action-001');
    const body = JSON.parse(String(item.init.body)) as Record<string, unknown>;
    assert.equal('actorId' in body, false);
    assert.equal('actorRoles' in body, false);
  }
});

test('Human Safety conflicts and outages are sanitized and mark the outcome ambiguous', async () => {
  for (const status of [409, 500]) {
    const gateway = new HttpHumanSafetyCommandCenterGateway('', session, async () => response(status, null, {
      code: 'INTERNAL_SQL',
      message: 'SELECT * FROM secret_table'
    }));
    await assert.rejects(() => gateway.takeover('case-001', {
      actorId: '11111111-1111-4111-8111-111111111111',
      actorRoles: ['OPERATOR'], expectedCaseVersion: 1, expectedContactVersion: null,
      reason: 'استحواذ بشري', traceId: 'trace-001', occurredAt: '2026-08-20T10:00:00.000Z',
      idempotencyKey: 'idem-001'
    }), (error: unknown) => {
      assert.ok(error instanceof CommandCenterRequestError);
      assert.equal(error.outcomeAmbiguous, true);
      assert.doesNotMatch(error.message, /SELECT|secret_table/i);
      return true;
    });
  }
});
