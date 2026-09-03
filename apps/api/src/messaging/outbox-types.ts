export interface OutboxMessage {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly tenantId?: string;
  readonly purpose?: string;
  readonly occurredAt: Date;
  readonly retryCount: number;
}

export interface OutboxRepository {
  claimBatch(workerId: string, batchSize: number, lockDurationMs: number): Promise<readonly OutboxMessage[]>;
  markPublished(messageId: string, workerId: string, publishedAt: Date): Promise<void>;
  markFailed(
    messageId: string,
    workerId: string,
    errorMessage: string,
    nextAttemptAt: Date,
    deadLetteredAt?: Date
  ): Promise<void>;
}

export interface EventBroker {
  publish(message: OutboxMessage, signal?: AbortSignal): Promise<void>;
}

export interface DeliveryMetrics {
  claimed(count: number): void;
  published(message: OutboxMessage): void;
  retried(message: OutboxMessage, nextAttemptAt: Date): void;
  deadLettered(message: OutboxMessage): void;
}

export interface ConsumerIdempotencyStore {
  tryBegin(consumerName: string, messageId: string, leaseDurationMs: number): Promise<boolean>;
  complete(consumerName: string, messageId: string): Promise<void>;
  release(consumerName: string, messageId: string): Promise<void>;
}

export interface IntegrationConsumer {
  readonly name: string;
  consume(message: OutboxMessage): Promise<'processed' | 'duplicate'>;
}

export class NullDeliveryMetrics implements DeliveryMetrics {
  claimed(_count: number): void {}
  published(_message: OutboxMessage): void {}
  retried(_message: OutboxMessage, _nextAttemptAt: Date): void {}
  deadLettered(_message: OutboxMessage): void {}
}
