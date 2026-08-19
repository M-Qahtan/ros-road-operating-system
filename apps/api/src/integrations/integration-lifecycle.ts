import { createHash } from 'node:crypto';
import { IntegrationPurpose } from './integration-principal.js';

export type IntegrationPartner =
  | 'EMERGENCY'
  | 'TRAFFIC'
  | 'ROAD_OPERATOR'
  | 'INSURANCE'
  | 'TOWING'
  | 'ROUTING';

export type IntegrationDeliveryState =
  | 'PREPARED'
  | 'ACCEPTED'
  | 'ACKNOWLEDGED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface IntegrationSourceSnapshot {
  readonly roadEventId: string;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly location: { readonly latitude: number; readonly longitude: number };
  readonly severity: {
    readonly level: string;
    readonly score: number;
    readonly reasonCodes: readonly string[];
  };
  readonly humanSafety: {
    readonly status: 'UNKNOWN' | 'OK' | 'NEEDS_HELP';
    readonly responseRequired: boolean;
  };
  readonly road: {
    readonly segmentId: string;
    readonly lanesBlocked: number;
    readonly closureState: 'OPEN' | 'RESTRICTED' | 'CLOSED';
  };
  readonly vehicle: {
    readonly vehicleClass: string;
    readonly mobility: 'DRIVABLE' | 'DISABLED';
  } | null;
  readonly insurance: {
    readonly policyReference: string;
  } | null;
  readonly personal: {
    readonly phone: string;
    readonly nationalId: string;
  } | null;
  readonly evidenceRefs: readonly string[];
}

export interface PreparedIntegrationRequest {
  readonly requestId: string;
  readonly partner: IntegrationPartner;
  readonly purpose: IntegrationPurpose;
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly projection: Readonly<Record<string, unknown>>;
  readonly preparedAt: string;
}

export interface IntegrationSendReceipt {
  readonly providerRequestId: string;
  readonly requestId: string;
  readonly partner: IntegrationPartner;
  readonly state: 'ACCEPTED';
  readonly acceptedAt: string;
}

export interface IntegrationStatus {
  readonly providerRequestId: string;
  readonly requestId: string;
  readonly partner: IntegrationPartner;
  readonly state: IntegrationDeliveryState;
  readonly updatedAt: string;
  readonly reason: string | null;
}

export interface IntegrationCallbackInput {
  readonly callbackId: string;
  readonly providerRequestId: string;
  readonly state: 'ACKNOWLEDGED' | 'COMPLETED' | 'FAILED';
  readonly reason?: string;
  readonly occurredAt: string;
}

export interface IntegrationPrepareInput {
  readonly requestId: string;
  readonly partner: IntegrationPartner;
  readonly purpose: IntegrationPurpose;
  readonly idempotencyKey: string;
  readonly source: IntegrationSourceSnapshot;
  readonly preparedAt: string;
}

export interface IntegrationAdapterPort {
  prepare(input: IntegrationPrepareInput): Promise<PreparedIntegrationRequest>;
  send(request: PreparedIntegrationRequest): Promise<IntegrationSendReceipt>;
  status(providerRequestId: string): Promise<IntegrationStatus>;
  cancel(providerRequestId: string, reason: string, cancelledAt: string): Promise<IntegrationStatus>;
  handleCallback(input: IntegrationCallbackInput): Promise<IntegrationStatus>;
}

export class IntegrationLifecycleError extends Error {
  override readonly name = 'IntegrationLifecycleError';
}

const PURPOSE_BY_PARTNER: Readonly<Record<IntegrationPartner, IntegrationPurpose>> = {
  EMERGENCY: 'EMERGENCY_COORDINATION',
  TRAFFIC: 'TRAFFIC_COORDINATION',
  ROAD_OPERATOR: 'TRAFFIC_COORDINATION',
  INSURANCE: 'INSURANCE_COORDINATION',
  TOWING: 'TOWING_COORDINATION',
  ROUTING: 'ROUTE_COORDINATION'
};

function requireText(value: string, field: string, maximum = 256): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new IntegrationLifecycleError(`${field} must contain between 1 and ${maximum} characters`);
  }
  return normalized;
}

function iso(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new IntegrationLifecycleError(`${field} must be an ISO timestamp`);
  return parsed.toISOString();
}

function location(source: IntegrationSourceSnapshot) {
  const { latitude, longitude } = source.location;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new IntegrationLifecycleError('location.latitude is invalid');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new IntegrationLifecycleError('location.longitude is invalid');
  }
  return Object.freeze({ latitude, longitude });
}

/**
 * Produces the partner-specific payload boundary. Sensitive source fields are
 * intentionally absent unless they are strictly required for that partner.
 */
export function projectMinimumNecessary(
  partner: IntegrationPartner,
  source: IntegrationSourceSnapshot
): Readonly<Record<string, unknown>> {
  const roadEventId = requireText(source.roadEventId, 'roadEventId', 128);
  const occurredAt = iso(source.occurredAt, 'occurredAt');
  const eventLocation = location(source);
  const severityLevel = requireText(source.severity.level, 'severity.level', 32);
  const segmentId = requireText(source.road.segmentId, 'road.segmentId', 128);

  switch (partner) {
    case 'EMERGENCY':
      return Object.freeze({
        roadEventId,
        occurredAt,
        location: eventLocation,
        severityLevel,
        humanSafety: Object.freeze({
          status: source.humanSafety.status,
          responseRequired: source.humanSafety.responseRequired
        })
      });
    case 'TRAFFIC':
      return Object.freeze({
        roadEventId,
        occurredAt,
        location: eventLocation,
        severityLevel,
        road: Object.freeze({
          segmentId,
          lanesBlocked: source.road.lanesBlocked,
          closureState: source.road.closureState
        })
      });
    case 'ROAD_OPERATOR':
      return Object.freeze({
        roadEventId,
        occurredAt,
        location: eventLocation,
        road: Object.freeze({
          segmentId,
          lanesBlocked: source.road.lanesBlocked,
          closureState: source.road.closureState
        })
      });
    case 'INSURANCE':
      if (source.insurance === null) throw new IntegrationLifecycleError('insurance policy reference is required');
      return Object.freeze({
        roadEventId,
        occurredAt,
        location: eventLocation,
        policyReference: requireText(source.insurance.policyReference, 'insurance.policyReference', 128)
      });
    case 'TOWING':
      if (source.vehicle === null) throw new IntegrationLifecycleError('vehicle mobility data is required');
      return Object.freeze({
        roadEventId,
        location: eventLocation,
        vehicle: Object.freeze({
          vehicleClass: requireText(source.vehicle.vehicleClass, 'vehicle.vehicleClass', 64),
          mobility: source.vehicle.mobility
        })
      });
    case 'ROUTING':
      return Object.freeze({
        roadEventId,
        road: Object.freeze({
          segmentId,
          lanesBlocked: source.road.lanesBlocked,
          closureState: source.road.closureState
        })
      });
  }
}

interface StoredDelivery {
  readonly receipt: IntegrationSendReceipt;
  state: IntegrationDeliveryState;
  updatedAt: string;
  reason: string | null;
}

function fingerprint(request: PreparedIntegrationRequest): string {
  return createHash('sha256').update(JSON.stringify({
    requestId: request.requestId,
    partner: request.partner,
    purpose: request.purpose,
    tenantId: request.tenantId,
    projection: request.projection
  })).digest('hex');
}

/**
 * Deterministic, in-process simulator for contract and failure-mode tests only.
 * It never performs network I/O and must not be used as an official dispatch
 * channel. Logical delivery is idempotent by partner + idempotencyKey.
 */
export class DeterministicIntegrationSimulator implements IntegrationAdapterPort {
  private readonly deliveries = new Map<string, StoredDelivery>();
  private readonly idempotency = new Map<string, { readonly fingerprint: string; readonly providerRequestId: string }>();
  private readonly callbackStates = new Map<string, { readonly providerRequestId: string; readonly state: string }>();

  async prepare(input: IntegrationPrepareInput): Promise<PreparedIntegrationRequest> {
    const expectedPurpose = PURPOSE_BY_PARTNER[input.partner];
    if (input.purpose !== expectedPurpose) {
      throw new IntegrationLifecycleError(`${input.partner} requires purpose ${expectedPurpose}`);
    }
    return Object.freeze({
      requestId: requireText(input.requestId, 'requestId', 128),
      partner: input.partner,
      purpose: input.purpose,
      tenantId: requireText(input.source.tenantId, 'tenantId', 128),
      idempotencyKey: requireText(input.idempotencyKey, 'idempotencyKey', 128),
      projection: projectMinimumNecessary(input.partner, input.source),
      preparedAt: iso(input.preparedAt, 'preparedAt')
    });
  }

  async send(request: PreparedIntegrationRequest): Promise<IntegrationSendReceipt> {
    const key = `${request.partner}:${request.idempotencyKey}`;
    const requestFingerprint = fingerprint(request);
    const existing = this.idempotency.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== requestFingerprint) {
        throw new IntegrationLifecycleError('Integration idempotency key was reused with a different request');
      }
      return this.requireDelivery(existing.providerRequestId).receipt;
    }

    const providerRequestId = `sim-${createHash('sha256')
      .update(`${request.partner}:${request.requestId}`)
      .digest('hex')
      .slice(0, 24)}`;
    const receipt: IntegrationSendReceipt = Object.freeze({
      providerRequestId,
      requestId: request.requestId,
      partner: request.partner,
      state: 'ACCEPTED',
      acceptedAt: request.preparedAt
    });
    this.deliveries.set(providerRequestId, {
      receipt,
      state: 'ACCEPTED',
      updatedAt: request.preparedAt,
      reason: null
    });
    this.idempotency.set(key, { fingerprint: requestFingerprint, providerRequestId });
    return receipt;
  }

  async status(providerRequestId: string): Promise<IntegrationStatus> {
    return this.snapshot(this.requireDelivery(requireText(providerRequestId, 'providerRequestId', 128)));
  }

  async cancel(providerRequestId: string, reason: string, cancelledAt: string): Promise<IntegrationStatus> {
    const delivery = this.requireDelivery(requireText(providerRequestId, 'providerRequestId', 128));
    if (delivery.state === 'COMPLETED') {
      throw new IntegrationLifecycleError('Completed integration delivery cannot be cancelled');
    }
    delivery.state = 'CANCELLED';
    delivery.reason = requireText(reason, 'cancel reason', 500);
    delivery.updatedAt = iso(cancelledAt, 'cancelledAt');
    return this.snapshot(delivery);
  }

  async handleCallback(input: IntegrationCallbackInput): Promise<IntegrationStatus> {
    const callbackId = requireText(input.callbackId, 'callbackId', 128);
    const providerRequestId = requireText(input.providerRequestId, 'providerRequestId', 128);
    const delivery = this.requireDelivery(providerRequestId);
    const replay = this.callbackStates.get(callbackId);
    if (replay !== undefined) {
      if (replay.providerRequestId !== providerRequestId || replay.state !== input.state) {
        throw new IntegrationLifecycleError('Callback id was replayed with different semantics');
      }
      return this.snapshot(delivery);
    }
    if (delivery.state === 'CANCELLED' || delivery.state === 'COMPLETED') {
      throw new IntegrationLifecycleError(`Callback cannot transition delivery from ${delivery.state}`);
    }
    delivery.state = input.state;
    delivery.reason = input.reason === undefined ? null : requireText(input.reason, 'callback reason', 500);
    delivery.updatedAt = iso(input.occurredAt, 'callback occurredAt');
    this.callbackStates.set(callbackId, { providerRequestId, state: input.state });
    return this.snapshot(delivery);
  }

  private requireDelivery(providerRequestId: string): StoredDelivery {
    const delivery = this.deliveries.get(providerRequestId);
    if (delivery === undefined) throw new IntegrationLifecycleError('Integration delivery was not found');
    return delivery;
  }

  private snapshot(delivery: StoredDelivery): IntegrationStatus {
    return Object.freeze({
      providerRequestId: delivery.receipt.providerRequestId,
      requestId: delivery.receipt.requestId,
      partner: delivery.receipt.partner,
      state: delivery.state,
      updatedAt: delivery.updatedAt,
      reason: delivery.reason
    });
  }
}
