import {
  ConsumerIdempotencyStore,
  IntegrationConsumer,
  OutboxMessage
} from './outbox-types.js';

export type SimulatedAgency = 'AMBULANCE' | 'TRAFFIC_OPERATIONS' | 'TOWING';

export interface SimulatedAgencyNotification {
  readonly agency: SimulatedAgency;
  readonly eventId: string;
  readonly roadEventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly simulation: true;
}

export interface SimulatedAgencySink {
  record(notification: SimulatedAgencyNotification): Promise<void>;
}

const ROUTES: Readonly<Record<SimulatedAgency, readonly string[]>> = Object.freeze({
  AMBULANCE: Object.freeze(['SafetyEscalated', 'AmbulanceNotificationRequested']),
  TRAFFIC_OPERATIONS: Object.freeze(['RoadEventConfirmed', 'TrafficActionRequested', 'RoadRestored']),
  TOWING: Object.freeze(['TowingNotificationRequested', 'RoadClearanceStarted'])
});

export class SimulatedAgencyConsumer implements IntegrationConsumer {
  readonly name: string;

  constructor(
    readonly agency: SimulatedAgency,
    private readonly idempotency: ConsumerIdempotencyStore,
    private readonly sink: SimulatedAgencySink,
    private readonly leaseDurationMs = 60_000
  ) {
    this.name = `simulated-${agency.toLowerCase()}`;
  }

  async consume(message: OutboxMessage): Promise<'processed' | 'duplicate'> {
    if (!ROUTES[this.agency].includes(message.eventType)) return 'processed';
    const acquired = await this.idempotency.tryBegin(this.name, message.id, this.leaseDurationMs);
    if (!acquired) return 'duplicate';

    try {
      await this.sink.record({
        agency: this.agency,
        eventId: message.id,
        roadEventId: message.aggregateId,
        eventType: message.eventType,
        correlationId: message.correlationId,
        ...(message.traceId === undefined ? {} : { traceId: message.traceId }),
        simulation: true
      });
      await this.idempotency.complete(this.name, message.id);
      return 'processed';
    } catch (error) {
      await this.idempotency.release(this.name, message.id);
      throw error;
    }
  }
}
