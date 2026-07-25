import { PostgresClient, PostgresPool } from '../persistence/postgres/postgres-types.js';
import { ConsumerIdempotencyStore, OutboxMessage, OutboxRepository } from './outbox-types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OutboxRow {
  readonly id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly trace_id: string | null;
  readonly occurred_at: Date | string;
  readonly retry_count: number;
}

function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new TypeError(`${field} must be a UUID`);
  return value;
}

function requireWorkerId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new TypeError('workerId must contain between 1 and 128 characters');
  }
  return normalized;
}

function requirePositiveInteger(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${field} must be between 1 and ${maximum}`);
  }
  return value;
}

function mapMessage(row: OutboxRow): OutboxMessage {
  const occurredAt = row.occurred_at instanceof Date ? new Date(row.occurred_at.getTime()) : new Date(row.occurred_at);
  if (!Number.isFinite(occurredAt.getTime())) throw new TypeError('Outbox occurred_at is invalid');
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: Object.freeze({ ...row.payload }),
    correlationId: row.correlation_id,
    ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
    ...(row.trace_id === null ? {} : { traceId: row.trace_id }),
    occurredAt,
    retryCount: row.retry_count
  };
}

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly pool: PostgresPool) {}

  async claimBatch(workerId: string, batchSize: number, lockDurationMs: number): Promise<readonly OutboxMessage[]> {
    const owner = requireWorkerId(workerId);
    requirePositiveInteger(batchSize, 'batchSize', 500);
    requirePositiveInteger(lockDurationMs, 'lockDurationMs', 60 * 60 * 1_000);
    const client = await this.pool.connect();
    try {
      const result = await client.query<OutboxRow>(
        `WITH candidates AS (
           SELECT id
           FROM outbox_events
           WHERE published_at IS NULL
             AND dead_lettered_at IS NULL
             AND next_attempt_at <= now()
             AND (locked_until IS NULL OR locked_until < now())
           ORDER BY occurred_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE outbox_events AS event
         SET locked_by = $2,
             locked_until = now() + ($3 * interval '1 millisecond')
         FROM candidates
         WHERE event.id = candidates.id
         RETURNING event.id, event.aggregate_type, event.aggregate_id, event.event_type,
                   event.payload, event.correlation_id, event.causation_id, event.trace_id,
                   event.occurred_at, event.retry_count`,
        [batchSize, owner, lockDurationMs]
      );
      return result.rows.map(mapMessage);
    } finally {
      client.release();
    }
  }

  async markPublished(messageId: string, workerId: string, publishedAt: Date): Promise<void> {
    requireUuid(messageId, 'messageId');
    const owner = requireWorkerId(workerId);
    if (!Number.isFinite(publishedAt.getTime())) throw new TypeError('publishedAt is invalid');
    await this.executeOwnedUpdate(
      `UPDATE outbox_events
       SET published_at = $3, locked_by = NULL, locked_until = NULL, last_error = NULL
       WHERE id = $1::uuid AND locked_by = $2 AND published_at IS NULL AND dead_lettered_at IS NULL`,
      [messageId, owner, publishedAt],
      messageId
    );
  }

  async markFailed(
    messageId: string,
    workerId: string,
    errorMessage: string,
    nextAttemptAt: Date,
    deadLetteredAt?: Date
  ): Promise<void> {
    requireUuid(messageId, 'messageId');
    const owner = requireWorkerId(workerId);
    const error = errorMessage.trim().slice(0, 1_000);
    if (error.length === 0) throw new TypeError('errorMessage cannot be empty');
    if (!Number.isFinite(nextAttemptAt.getTime())) throw new TypeError('nextAttemptAt is invalid');
    if (deadLetteredAt !== undefined && !Number.isFinite(deadLetteredAt.getTime())) {
      throw new TypeError('deadLetteredAt is invalid');
    }
    await this.executeOwnedUpdate(
      `UPDATE outbox_events
       SET retry_count = retry_count + 1,
           next_attempt_at = $3,
           dead_lettered_at = $4,
           last_error = $5,
           locked_by = NULL,
           locked_until = NULL
       WHERE id = $1::uuid AND locked_by = $2 AND published_at IS NULL AND dead_lettered_at IS NULL`,
      [messageId, owner, nextAttemptAt, deadLetteredAt ?? null, error],
      messageId
    );
  }

  private async executeOwnedUpdate(text: string, values: readonly unknown[], messageId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, values);
      if (result.rowCount !== 1) {
        throw new Error(`Outbox message ${messageId} is no longer owned by this worker`);
      }
    } finally {
      client.release();
    }
  }
}

export class PostgresConsumerIdempotencyStore implements ConsumerIdempotencyStore {
  constructor(private readonly pool: PostgresPool) {}

  async tryBegin(consumerName: string, messageId: string, leaseDurationMs: number): Promise<boolean> {
    const name = consumerName.trim();
    if (name.length === 0 || name.length > 128) throw new TypeError('consumerName is invalid');
    requireUuid(messageId, 'messageId');
    requirePositiveInteger(leaseDurationMs, 'leaseDurationMs', 60 * 60 * 1_000);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO processed_integration_events (consumer_name, event_id, status, locked_until)
         VALUES ($1, $2::uuid, 'PROCESSING', now() + ($3 * interval '1 millisecond'))
         ON CONFLICT (consumer_name, event_id) DO UPDATE
           SET status = 'PROCESSING', locked_until = EXCLUDED.locked_until, updated_at = now()
           WHERE processed_integration_events.status <> 'COMPLETED'
             AND processed_integration_events.locked_until < now()
         RETURNING event_id`,
        [name, messageId, leaseDurationMs]
      );
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }

  async complete(consumerName: string, messageId: string): Promise<void> {
    await this.updateState(consumerName, messageId,
      `UPDATE processed_integration_events
       SET status = 'COMPLETED', completed_at = now(), locked_until = NULL, updated_at = now()
       WHERE consumer_name = $1 AND event_id = $2::uuid AND status = 'PROCESSING'`);
  }

  async release(consumerName: string, messageId: string): Promise<void> {
    await this.updateState(consumerName, messageId,
      `DELETE FROM processed_integration_events
       WHERE consumer_name = $1 AND event_id = $2::uuid AND status = 'PROCESSING'`);
  }

  private async updateState(consumerName: string, messageId: string, text: string): Promise<void> {
    const name = consumerName.trim();
    if (name.length === 0 || name.length > 128) throw new TypeError('consumerName is invalid');
    requireUuid(messageId, 'messageId');
    const client = await this.pool.connect();
    try {
      await client.query(text, [name, messageId]);
    } finally {
      client.release();
    }
  }
}
