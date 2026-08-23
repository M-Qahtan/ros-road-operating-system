import { EventBroker, OutboxMessage } from './outbox-types.js';

export interface RedisStreamClient {
  xadd(stream: string, id: '*', fields: Readonly<Record<string, string>>): Promise<string>;
}

function requireStreamName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) throw new TypeError('Redis stream name is invalid');
  return normalized;
}

export class RedisStreamEventBroker implements EventBroker {
  private readonly stream: string;

  constructor(
    private readonly client: RedisStreamClient,
    stream = 'ros:integration-events',
    private readonly simulationMode = true
  ) {
    this.stream = requireStreamName(stream);
  }

  async publish(message: OutboxMessage): Promise<void> {
    if (message.aggregateType === 'RoadEvent' && (message.tenantId === undefined || message.purpose === undefined)) {
      throw new Error(`RoadEvent outbox message ${message.id} is missing trusted access scope`);
    }
    const fields: Record<string, string> = {
      eventId: message.id,
      aggregateType: message.aggregateType,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: JSON.stringify(message.payload),
      correlationId: message.correlationId,
      occurredAt: message.occurredAt.toISOString(),
      retryCount: String(message.retryCount),
      simulationMode: String(this.simulationMode),
      deliveryMode: this.simulationMode ? 'simulation' : 'runtime'
    };
    if (message.causationId !== undefined) fields.causationId = message.causationId;
    if (message.traceId !== undefined) fields.traceId = message.traceId;
    if (message.tenantId !== undefined) fields.tenantId = message.tenantId;
    if (message.purpose !== undefined) fields.purpose = message.purpose;
    await this.client.xadd(this.stream, '*', fields);
  }
}
