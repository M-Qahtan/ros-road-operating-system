import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RoadEvent,
  RoadEventConcurrencyError,
  RoadEventNotFoundError,
  RoadEventStatus,
  SeverityLevel
} from '@ros/domain';
import { PostgresRoadEventRepository } from './postgres-road-event-repository.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from './postgres-types.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = '33333333-3333-4333-8333-333333333333';
const CORRELATION_ID = '44444444-4444-4444-8444-444444444444';
const SCOPE = { tenantId: 'riyadh-pilot', purpose: 'road-safety-response' } as const;

interface CapturedQuery { readonly text: string; readonly values: readonly unknown[]; }
type QueryHandler = (text: string, values: readonly unknown[]) => PostgresQueryResult<unknown>;

class FakeClient implements PostgresClient {
  readonly queries: CapturedQuery[] = [];
  released = false;
  constructor(private readonly handler: QueryHandler) {}
  async query<Row = unknown>(text: string, values: readonly unknown[] = []): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values });
    return this.handler(text, values) as PostgresQueryResult<Row>;
  }
  release(): void { this.released = true; }
}

class FakePool implements PostgresPool {
  constructor(readonly client: FakeClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

const context = {
  ...SCOPE,
  actorType: 'OPERATOR',
  actorId: ACTOR_ID,
  action: 'road_event.created',
  traceId: TRACE_ID,
  eventType: 'RoadEventCreated',
  correlationId: CORRELATION_ID,
  occurredAt: new Date('2026-07-25T03:00:00.000Z')
} as const;

function event(version = 1): RoadEvent {
  return new RoadEvent({
    id: EVENT_ID,
    occurredAt: new Date('2026-07-25T02:55:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    version,
    severity: {
      level: SeverityLevel.Moderate,
      score: 45,
      confidence: 0.8,
      reasonCodes: ['multi_signal_confirmation'],
      requiresHumanReview: true
    }
  });
}

function row(version = 1) {
  return {
    id: EVENT_ID,
    tenant_id: SCOPE.tenantId,
    purpose: SCOPE.purpose,
    status: RoadEventStatus.Detected,
    severity: SeverityLevel.Moderate,
    severity_score: 45,
    confidence: '0.800',
    reason_codes: ['multi_signal_confirmation'],
    severity_requires_human_review: true,
    longitude: 46.6753,
    latitude: 24.7136,
    occurred_at: '2026-07-25T02:55:00.000Z',
    version,
    closure_authorized_by: null,
    closure_authorized_at: null,
    closure_authorization_reason: null
  };
}

test('create writes scoped RoadEvent, audit and outbox in one transaction using parameters', async () => {
  const client = new FakeClient(() => ({ rows: [], rowCount: 1 }));
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  await repository.create(event(), context);

  assert.deepEqual(client.queries.map((query) => query.text.trim().split(/\s+/)[0]), ['BEGIN', 'INSERT', 'INSERT', 'INSERT', 'COMMIT']);
  assert.match(client.queries[1]!.text, /tenant_id, purpose/);
  assert.match(client.queries[1]!.text, /ST_SetSRID\(ST_MakePoint\(\$10, \$11\)/);
  assert.equal(client.queries[1]!.values[0], EVENT_ID);
  assert.equal(client.queries[1]!.values[1], SCOPE.tenantId);
  assert.equal(client.queries[1]!.values[2], SCOPE.purpose);
  assert.equal(client.queries[2]!.values[7], TRACE_ID);
  assert.equal(client.queries[3]!.values[3], CORRELATION_ID);
  assert.equal(client.released, true);
});

test('update rejects a stale expected version before writing audit or outbox', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FOR UPDATE')) return { rows: [row(2)], rowCount: 1 };
    return { rows: [], rowCount: null };
  });
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  const updated = event(2);
  updated.transitionTo(RoadEventStatus.Validating);

  await assert.rejects(() => repository.update(updated, 1, context), RoadEventConcurrencyError);
  assert.equal(client.queries.some((query) => query.text.includes('UPDATE road_events')), false);
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO audit_logs')), false);
  assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
});

test('update treats wrong tenant or purpose as not-found', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FOR UPDATE')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: null };
  });
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  const updated = event(2);
  updated.transitionTo(RoadEventStatus.Validating);

  await assert.rejects(
    () => repository.update(updated, 1, { ...context, tenantId: 'another-tenant' }),
    RoadEventNotFoundError
  );
  const select = client.queries.find((query) => query.text.includes('FOR UPDATE'))!;
  assert.match(select.text, /tenant_id = \$2 AND purpose = \$3/);
  assert.deepEqual(select.values, [EVENT_ID, 'another-tenant', SCOPE.purpose]);
});

test('findById restores geography, severity and version only inside the requested scope', async () => {
  const client = new FakeClient((text, values) => text.includes('SELECT') && values[1] === SCOPE.tenantId
    ? { rows: [row(3)], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  const restored = await repository.findById(EVENT_ID, SCOPE);
  const hidden = await repository.findById(EVENT_ID, { tenantId: 'another-tenant', purpose: SCOPE.purpose });

  assert.equal(restored?.id, EVENT_ID);
  assert.equal(restored?.latitude, 24.7136);
  assert.equal(restored?.longitude, 46.6753);
  assert.equal(restored?.severity.level, SeverityLevel.Moderate);
  assert.equal(restored?.version, 3);
  assert.equal(hidden, undefined);
  assert.match(client.queries[0]!.text, /tenant_id = \$2 AND purpose = \$3/);
});

test('list scopes in SQL before filters, pagination and total count', async () => {
  const client = new FakeClient(() => ({ rows: [{ ...row(), total_count: '7' }], rowCount: 1 }));
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  const page = await repository.list({
    statuses: [RoadEventStatus.Detected],
    severities: [SeverityLevel.Moderate],
    occurredFrom: new Date('2026-07-25T00:00:00.000Z'),
    occurredTo: new Date('2026-07-26T00:00:00.000Z'),
    limit: 20,
    offset: 40
  }, SCOPE);

  assert.equal(page.total, 7);
  assert.equal(page.items.length, 1);
  assert.deepEqual(client.queries[0]!.values.slice(0, 2), [SCOPE.tenantId, SCOPE.purpose]);
  assert.deepEqual(client.queries[0]!.values.slice(-2), [20, 40]);
  assert.match(client.queries[0]!.text, /tenant_id = \$1/);
  assert.match(client.queries[0]!.text, /purpose = \$2/);
  assert.match(client.queries[0]!.text, /status = ANY\(\$3::road_event_status\[\]\)/);
  assert.match(client.queries[0]!.text, /severity = ANY\(\$4::severity_level\[\]\)/);
  assert.match(client.queries[0]!.text, /COUNT\(\*\) OVER\(\) AS total_count/);
});
