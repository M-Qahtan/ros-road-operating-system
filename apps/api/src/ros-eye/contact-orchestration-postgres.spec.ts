import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POSTGRES_CONTACT_RUNTIME_SQL,
  PostgresContactRuntimeRepository,
  type ContactSqlConnectionPort,
  type ContactSqlPoolPort,
  type ContactSqlQueryResult,
  type ContactSqlRow
} from './contact-orchestration-postgres.js';
import type { ProcessClaimedOutboxInput } from './contact-orchestration.js';

const input: ProcessClaimedOutboxInput = {
  tenantId: 'tenant-riyadh',
  caseId: 'case-001',
  sessionId: 'session-001',
  messageId: 'message-001',
  workerId: 'worker-001',
  now: '2026-07-29T15:00:00.000Z',
  retryAvailableAt: '2026-07-29T15:00:15.000Z',
  errorCode: 'channel_delivery_failed_or_timed_out',
  deliveryToken: 'delivery-token-001',
  deliveryDeadlineAt: '2099-07-29T15:00:05.000Z'
};

function outboxRow(overrides: ContactSqlRow = {}): ContactSqlRow {
  return {
    tenant_id: input.tenantId,
    case_id: input.caseId,
    session_id: input.sessionId,
    message_id: input.messageId,
    channel: 'IN_APP',
    prompt_id: 'contact.consent',
    idempotency_key: 'stable-provider-key',
    available_at: input.now,
    attempt: 1,
    lease_owner: input.workerId,
    lease_expires_at: '2099-07-29T15:00:30.000Z',
    delivered_at: null,
    cancelled_at: null,
    last_error_code: null,
    delivery_token: input.deliveryToken,
    delivery_started_at: input.now,
    delivery_deadline_at: input.deliveryDeadlineAt,
    ...overrides
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

class TrackingPool implements ContactSqlPoolPort, ContactSqlConnectionPort {
  activeTransactions = 0;
  maximumActiveTransactions = 0;
  transactionStarts = 0;
  cancelled = false;
  delivered = false;
  retried = false;

  async transaction<T>(work: (connection: ContactSqlConnectionPort) => Promise<T>): Promise<T> {
    this.transactionStarts += 1;
    this.activeTransactions += 1;
    this.maximumActiveTransactions = Math.max(this.maximumActiveTransactions, this.activeTransactions);
    try { return await work(this); }
    finally { this.activeTransactions -= 1; }
  }

  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string): Promise<ContactSqlQueryResult<Row>> {
    if (text === POSTGRES_CONTACT_RUNTIME_SQL.reserveOutboxDelivery) {
      const rows = this.cancelled ? [] : [outboxRow()];
      return { rowCount: rows.length, rows: rows as unknown as Row[] };
    }
    if (text === POSTGRES_CONTACT_RUNTIME_SQL.markOutboxDelivered) {
      if (this.cancelled) return { rowCount: 0, rows: [] };
      this.delivered = true;
      return { rowCount: 1, rows: [] };
    }
    if (text === POSTGRES_CONTACT_RUNTIME_SQL.markOutboxRetry) {
      if (this.cancelled) return { rowCount: 0, rows: [] };
      this.retried = true;
      return { rowCount: 1, rows: [] };
    }
    if (text === POSTGRES_CONTACT_RUNTIME_SQL.readOutboxStatus) {
      const rows = [{ delivered_at: this.delivered ? input.now : null, cancelled_at: this.cancelled ? input.now : null, delivery_token: this.cancelled ? null : input.deliveryToken }];
      return { rowCount: 1, rows: rows as unknown as Row[] };
    }
    if (text === POSTGRES_CONTACT_RUNTIME_SQL.releaseOutboxLease) return { rowCount: 1, rows: [] };
    throw new Error(`unexpected SQL in tracking pool: ${text.slice(0, 48)}`);
  }
}

test('PostgreSQL delivery reservation commits before the provider callback and finalizes in a new transaction', async () => {
  const pool = new TrackingPool(); const repository = new PostgresContactRuntimeRepository(pool);
  const observedMessageIds: string[] = [];
  const result = await repository.processClaimedOutbox(input, async (message) => {
    observedMessageIds.push(message.messageId);
    assert.equal(pool.activeTransactions, 0, 'provider callback must not own a SQL transaction or row lock');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(pool.activeTransactions, 0);
    return 'SENT';
  });
  assert.equal(result, 'DELIVERED'); assert.deepEqual(observedMessageIds, [input.messageId]);
  assert.equal(pool.activeTransactions, 0); assert.equal(pool.maximumActiveTransactions, 1);
  assert.equal(pool.transactionStarts, 2); assert.equal(pool.delivered, true);
});

test('operator cancellation during provider execution is not blocked and fences later acknowledgement', async () => {
  const pool = new TrackingPool(); const repository = new PostgresContactRuntimeRepository(pool);
  const providerRelease = deferred(); const providerStarted = deferred();

  const running = repository.processClaimedOutbox(input, async () => {
    assert.equal(pool.activeTransactions, 0);
    providerStarted.resolve();
    await providerRelease.promise;
    return 'SENT';
  });

  await providerStarted.promise;
  assert.equal(pool.activeTransactions, 0);
  pool.cancelled = true;
  providerRelease.resolve();
  assert.equal(await running, 'CANCELLED');
  assert.equal(pool.delivered, false); assert.equal(pool.activeTransactions, 0);
});

test('failed provider result finalizes as a durable retry without leaking a transaction across the call', async () => {
  const pool = new TrackingPool(); const repository = new PostgresContactRuntimeRepository(pool);
  const result = await repository.processClaimedOutbox(input, async () => {
    assert.equal(pool.activeTransactions, 0);
    return 'UNAVAILABLE';
  });
  assert.equal(result, 'RETRY'); assert.equal(pool.retried, true);
  assert.equal(pool.transactionStarts, 2); assert.equal(pool.activeTransactions, 0);
});
