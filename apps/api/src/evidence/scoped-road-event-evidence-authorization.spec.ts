import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEvent } from '@ros/domain';
import { MemoryRoadEventRepository } from '../application/local-adapters.js';
import { ScopedRoadEventEvidenceAuthorization } from './scoped-road-event-evidence-authorization.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = 'riyadh-ops';
const PURPOSE = 'ROAD_SAFETY_OPERATIONS';

async function fixture() {
  const repository = new MemoryRoadEventRepository();
  await repository.create(new RoadEvent({
    id: EVENT_ID,
    occurredAt: new Date('2026-08-19T20:00:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753
  }), {
    tenantId: TENANT_ID,
    purpose: PURPOSE,
    actorType: 'SYSTEM',
    action: 'fixture.created',
    traceId: '22222222-2222-4222-8222-222222222222',
    eventType: 'FixtureCreated',
    correlationId: EVENT_ID
  });
  return new ScopedRoadEventEvidenceAuthorization(repository);
}

test('evidence authorization follows the authoritative RoadEvent tenant/purpose scope', async () => {
  const authorization = await fixture();
  assert.equal(await authorization.canAccess({
    actorId: 'operator-a',
    tenantId: TENANT_ID,
    purpose: PURPOSE
  }, EVENT_ID, 'UPLOAD'), true);
  assert.equal(await authorization.canAccess({
    actorId: 'operator-b',
    tenantId: 'other-tenant',
    purpose: PURPOSE
  }, EVENT_ID, 'UPLOAD'), false);
  assert.equal(await authorization.canAccess({
    actorId: 'auditor-a',
    tenantId: TENANT_ID,
    purpose: 'AUDIT_REVIEW'
  }, EVENT_ID, 'DOWNLOAD'), false);
});
