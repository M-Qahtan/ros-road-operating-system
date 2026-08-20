import { createHash } from 'node:crypto';
import { PostgresClient, PostgresPool } from '../persistence/postgres/postgres-types.js';
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

export interface TrustedIntegrationProfile {
  readonly profileId: string;
  readonly partner: IntegrationPartner;
  readonly purpose: IntegrationPurpose;
  readonly tenantId: string;
  readonly mode: 'SIMULATION_ONLY';
}

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
    readonly contactReference: string;
    readonly identityReference: string;
  } | null;
  readonly evidenceRefs: readonly string[];
}

export interface IntegrationPrepareInput {
  readonly logicalOperationId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly source: IntegrationSourceSnapshot;
  readonly preparedAt: string;
}

export interface PreparedIntegrationRequest {
  readonly logicalOperationId: string;
  readonly profileId: string;
  readonly partner: IntegrationPartner;
  readonly purpose: IntegrationPurpose;
  readonly tenantId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly projection: Readonly<Record<string, unknown>>;
  readonly preparedAt: string;
}

export interface IntegrationSendReceipt {
  readonly logicalOperationId: string;
  readonly providerRequestId: string;
  readonly profileId: string;
  readonly partner: IntegrationPartner;
  readonly state: 'ACCEPTED';
  readonly acceptedAt: string;
}

export interface IntegrationStatus {
  readonly logicalOperationId: string;
  readonly providerRequestId: string | null;
  readonly profileId: string;
  readonly partner: IntegrationPartner;
  readonly purpose: IntegrationPurpose;
  readonly tenantId: string;
  readonly state: IntegrationDeliveryState;
  readonly attemptCount: number;
  readonly acceptedAt: string | null;
  readonly updatedAt: string;
  readonly reason: string | null;
  readonly simulationOnly: true;
}

export interface IntegrationCallbackInput {
  readonly callbackId: string;
  readonly providerRequestId: string;
  readonly state: 'ACKNOWLEDGED' | 'COMPLETED' | 'FAILED';
  readonly reason?: string;
  readonly occurredAt: string;
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

const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const TERMINAL_STATES = new Set<IntegrationDeliveryState>(['COMPLETED', 'FAILED', 'CANCELLED']);

interface DeliveryRow {
  readonly logical_operation_id: string;
  readonly profile_id: string;
  readonly partner: IntegrationPartner;
  readonly purpose: IntegrationPurpose;
  readonly tenant_id: string;
  readonly request_id: string;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly projection: Readonly<Record<string, unknown>>;
  readonly state: IntegrationDeliveryState;
  readonly provider_request_id: string | null;
  readonly attempt_count: number;
  readonly prepared_at: Date | string;
  readonly accepted_at: Date | string | null;
  readonly updated_at: Date | string;
  readonly reason: string | null;
}

interface CallbackRow {
  readonly logical_operation_id: string;
  readonly semantic_fingerprint: string;
}

function requireText(value: string, field: string, maximum = 128, minimum = 1): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new IntegrationLifecycleError(`${field} must contain between ${minimum} and ${maximum} characters`);
  }
  return normalized;
}

function requireProfile(profile: TrustedIntegrationProfile): TrustedIntegrationProfile {
  if (
    profile.profileId.length < 1 ||
    profile.profileId.length > 128 ||
    profile.profileId !== profile.profileId.trim() ||
    !PROFILE_ID_PATTERN.test(profile.profileId)
  ) {
    throw new IntegrationLifecycleError('profileId must be a canonical token between 1 and 128 characters');
  }
  if (profile.mode !== 'SIMULATION_ONLY') {
    throw new IntegrationLifecycleError('Only SIMULATION_ONLY integration profiles are enabled');
  }
  const expectedPurpose = PURPOSE_BY_PARTNER[profile.partner];
  if (profile.purpose !== expectedPurpose) {
    throw new IntegrationLifecycleError(`${profile.partner} requires purpose ${expectedPurpose}`);
  }
  return Object.freeze({
    profileId: profile.profileId,
    partner: profile.partner,
    purpose: profile.purpose,
    tenantId: requireText(profile.tenantId, 'profile tenantId'),
    mode: 'SIMULATION_ONLY'
  });
}

function iso(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new IntegrationLifecycleError(`${field} must be an ISO timestamp`);
  return parsed.toISOString();
}

function rowIso(value: Date | string, field: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new IntegrationLifecycleError(`Persisted ${field} is invalid`);
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

function road(source: IntegrationSourceSnapshot) {
  if (!Number.isSafeInteger(source.road.lanesBlocked) || source.road.lanesBlocked < 0 || source.road.lanesBlocked > 16) {
    throw new IntegrationLifecycleError('road.lanesBlocked is invalid');
  }
  if (!['OPEN', 'RESTRICTED', 'CLOSED'].includes(source.road.closureState)) {
    throw new IntegrationLifecycleError('road.closureState is invalid');
  }
  return Object.freeze({
    segmentId: requireText(source.road.segmentId, 'road.segmentId'),
    lanesBlocked: source.road.lanesBlocked,
    closureState: source.road.closureState
  });
}

/** Purpose-specific minimum-necessary projection. Personal/evidence fields are excluded by default. */
export function projectMinimumNecessary(
  partner: IntegrationPartner,
  source: IntegrationSourceSnapshot
): Readonly<Record<string, unknown>> {
  const roadEventId = requireText(source.roadEventId, 'roadEventId');
  const occurredAt = iso(source.occurredAt, 'occurredAt');
  const eventLocation = location(source);
  const severityLevel = requireText(source.severity.level, 'severity.level', 32);
  const roadState = road(source);

  switch (partner) {
    case 'EMERGENCY':
      if (!['UNKNOWN', 'OK', 'NEEDS_HELP'].includes(source.humanSafety.status)) {
        throw new IntegrationLifecycleError('humanSafety.status is invalid');
      }
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
        road: roadState
      });
    case 'ROAD_OPERATOR':
      return Object.freeze({
        roadEventId,
        occurredAt,
        location: eventLocation,
        road: roadState
      });
    case 'INSURANCE':
      if (source.insurance === null) throw new IntegrationLifecycleError('insurance policy reference is required');
      return Object.freeze({
        roadEventId,
        occurredAt,
        location: eventLocation,
        policyReference: requireText(source.insurance.policyReference, 'insurance.policyReference')
      });
    case 'TOWING':
      if (source.vehicle === null) throw new IntegrationLifecycleError('vehicle mobility data is required');
      if (!['DRIVABLE', 'DISABLED'].includes(source.vehicle.mobility)) {
        throw new IntegrationLifecycleError('vehicle.mobility is invalid');
      }
      return Object.freeze({
        roadEventId,
        location: eventLocation,
        vehicle: Object.freeze({
          vehicleClass: requireText(source.vehicle.vehicleClass, 'vehicle.vehicleClass', 64),
          mobility: source.vehicle.mobility
        })
      });
    case 'ROUTING':
      return Object.freeze({ roadEventId, road: roadState });
  }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requestFingerprint(
  profile: TrustedIntegrationProfile,
  input: IntegrationPrepareInput,
  projection: Readonly<Record<string, unknown>>
): string {
  return sha256({
    logicalOperationId: input.logicalOperationId,
    profileId: profile.profileId,
    partner: profile.partner,
    purpose: profile.purpose,
    tenantId: profile.tenantId,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    causationId: input.causationId,
    projection
  });
}

function callbackFingerprint(input: IntegrationCallbackInput): string {
  return sha256({
    providerRequestId: input.providerRequestId,
    state: input.state,
    reason: input.reason?.trim() ?? null,
    occurredAt: iso(input.occurredAt, 'callback occurredAt')
  });
}

function providerRequestId(profileId: string, logicalOperationId: string): string {
  return `sim-${createHash('sha256').update(`${profileId}\u0000${logicalOperationId}`).digest('hex').slice(0, 32)}`;
}

function preparedFromRow(row: DeliveryRow): PreparedIntegrationRequest {
  return Object.freeze({
    logicalOperationId: row.logical_operation_id,
    profileId: row.profile_id,
    partner: row.partner,
    purpose: row.purpose,
    tenantId: row.tenant_id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    projection: Object.freeze({ ...row.projection }),
    preparedAt: rowIso(row.prepared_at, 'prepared_at')
  });
}

function statusFromRow(row: DeliveryRow): IntegrationStatus {
  return Object.freeze({
    logicalOperationId: row.logical_operation_id,
    providerRequestId: row.provider_request_id,
    profileId: row.profile_id,
    partner: row.partner,
    purpose: row.purpose,
    tenantId: row.tenant_id,
    state: row.state,
    attemptCount: row.attempt_count,
    acceptedAt: row.accepted_at === null ? null : rowIso(row.accepted_at, 'accepted_at'),
    updatedAt: rowIso(row.updated_at, 'updated_at'),
    reason: row.reason,
    simulationOnly: true
  });
}

function receiptFromRow(row: DeliveryRow): IntegrationSendReceipt {
  if (row.provider_request_id === null || row.accepted_at === null) {
    throw new IntegrationLifecycleError('Persisted delivery does not contain an acceptance receipt');
  }
  return Object.freeze({
    logicalOperationId: row.logical_operation_id,
    providerRequestId: row.provider_request_id,
    profileId: row.profile_id,
    partner: row.partner,
    state: 'ACCEPTED',
    acceptedAt: rowIso(row.accepted_at, 'accepted_at')
  });
}

async function rollbackQuietly(client: PostgresClient): Promise<void> {
  try { await client.query('ROLLBACK'); } catch { /* original error remains authoritative */ }
}

/**
 * PostgreSQL-backed deterministic sandbox. It performs no network I/O.
 * Provider ACCEPTED/ACKNOWLEDGED/COMPLETED states are transport simulation state only and never mutate ROS road/safety authority.
 */
export class PostgresIntegrationSandbox {
  constructor(private readonly pool: PostgresPool) {}

  async prepare(profileInput: TrustedIntegrationProfile, input: IntegrationPrepareInput): Promise<PreparedIntegrationRequest> {
    const profile = requireProfile(profileInput);
    if (requireText(input.source.tenantId, 'source tenantId') !== profile.tenantId) {
      throw new IntegrationLifecycleError('Source tenant does not match trusted integration profile');
    }
    const logicalOperationId = requireText(input.logicalOperationId, 'logicalOperationId');
    const requestId = requireText(input.requestId, 'requestId');
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 128, 16);
    const correlationId = requireText(input.correlationId, 'correlationId');
    const causationId = requireText(input.causationId, 'causationId');
    const preparedAt = iso(input.preparedAt, 'preparedAt');
    const projection = projectMinimumNecessary(profile.partner, input.source);
    const fingerprint = requestFingerprint(profile, {
      ...input,
      logicalOperationId,
      requestId,
      idempotencyKey,
      correlationId,
      causationId,
      preparedAt
    }, projection);

    return this.transaction(async (client) => {
      const inserted = await client.query<DeliveryRow>(
        `INSERT INTO integration_deliveries (
           logical_operation_id, profile_id, partner, purpose, tenant_id,
           request_id, idempotency_key, request_fingerprint, correlation_id,
           causation_id, projection, prepared_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::timestamptz,$12::timestamptz)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          logicalOperationId,
          profile.profileId,
          profile.partner,
          profile.purpose,
          profile.tenantId,
          requestId,
          idempotencyKey,
          fingerprint,
          correlationId,
          causationId,
          JSON.stringify(projection),
          preparedAt
        ]
      );
      if (inserted.rowCount === 1 && inserted.rows[0] !== undefined) return preparedFromRow(inserted.rows[0]);

      const existing = await client.query<DeliveryRow>(
        `SELECT * FROM integration_deliveries
          WHERE logical_operation_id = $1
             OR (profile_id = $2 AND idempotency_key = $3)
          ORDER BY logical_operation_id
          FOR UPDATE`,
        [logicalOperationId, profile.profileId, idempotencyKey]
      );
      if (existing.rowCount !== 1 || existing.rows[0] === undefined) {
        throw new IntegrationLifecycleError('Integration logical operation or idempotency identity conflicts with another delivery');
      }
      const row = existing.rows[0];
      if (
        row.logical_operation_id !== logicalOperationId ||
        row.profile_id !== profile.profileId ||
        row.idempotency_key !== idempotencyKey ||
        row.request_fingerprint !== fingerprint
      ) {
        throw new IntegrationLifecycleError('Integration idempotency key or logical operation was reused with different semantics');
      }
      return preparedFromRow(row);
    });
  }

  async send(
    profileInput: TrustedIntegrationProfile,
    logicalOperationIdInput: string,
    sentAtInput: string
  ): Promise<IntegrationSendReceipt> {
    const profile = requireProfile(profileInput);
    const logicalOperationId = requireText(logicalOperationIdInput, 'logicalOperationId');
    const sentAt = iso(sentAtInput, 'sentAt');

    return this.transaction(async (client) => {
      const row = await this.lockByOperation(client, profile.profileId, logicalOperationId);
      if (row.provider_request_id !== null) return receiptFromRow(row);
      if (row.state !== 'PREPARED') throw new IntegrationLifecycleError('Only a prepared delivery may be sent');
      if (new Date(sentAt).getTime() < new Date(rowIso(row.prepared_at, 'prepared_at')).getTime()) {
        throw new IntegrationLifecycleError('sentAt cannot precede preparedAt');
      }

      const providerId = providerRequestId(profile.profileId, logicalOperationId);
      const updated = await client.query<DeliveryRow>(
        `UPDATE integration_deliveries
            SET state = 'ACCEPTED', provider_request_id = $3,
                attempt_count = attempt_count + 1,
                accepted_at = $4::timestamptz, updated_at = $4::timestamptz
          WHERE logical_operation_id = $1 AND profile_id = $2
          RETURNING *`,
        [logicalOperationId, profile.profileId, providerId, sentAt]
      );
      if (updated.rowCount !== 1 || updated.rows[0] === undefined) {
        throw new IntegrationLifecycleError('Integration delivery could not be accepted');
      }
      return receiptFromRow(updated.rows[0]);
    });
  }

  async status(profileInput: TrustedIntegrationProfile, providerRequestIdInput: string): Promise<IntegrationStatus> {
    const profile = requireProfile(profileInput);
    const providerId = requireText(providerRequestIdInput, 'providerRequestId');
    const client = await this.pool.connect();
    try {
      const result = await client.query<DeliveryRow>(
        `SELECT * FROM integration_deliveries WHERE profile_id = $1 AND provider_request_id = $2`,
        [profile.profileId, providerId]
      );
      if (result.rowCount !== 1 || result.rows[0] === undefined) {
        throw new IntegrationLifecycleError('Integration delivery was not found');
      }
      return statusFromRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async cancel(
    profileInput: TrustedIntegrationProfile,
    providerRequestIdInput: string,
    reasonInput: string,
    cancelledAtInput: string
  ): Promise<IntegrationStatus> {
    const profile = requireProfile(profileInput);
    const providerId = requireText(providerRequestIdInput, 'providerRequestId');
    const reason = requireText(reasonInput, 'cancel reason', 500);
    const cancelledAt = iso(cancelledAtInput, 'cancelledAt');

    return this.transaction(async (client) => {
      const row = await this.lockByProvider(client, profile.profileId, providerId);
      if (row.state === 'CANCELLED') {
        if (row.reason !== reason) throw new IntegrationLifecycleError('Cancellation replay changed its reason');
        return statusFromRow(row);
      }
      if (row.state === 'COMPLETED' || row.state === 'FAILED') {
        throw new IntegrationLifecycleError(`Terminal ${row.state} delivery cannot be cancelled`);
      }
      if (new Date(cancelledAt).getTime() < new Date(rowIso(row.updated_at, 'updated_at')).getTime()) {
        throw new IntegrationLifecycleError('Cancellation timestamp is older than current delivery state');
      }
      const updated = await client.query<DeliveryRow>(
        `UPDATE integration_deliveries
            SET state = 'CANCELLED', reason = $3, updated_at = $4::timestamptz
          WHERE logical_operation_id = $1 AND profile_id = $2
          RETURNING *`,
        [row.logical_operation_id, profile.profileId, reason, cancelledAt]
      );
      if (updated.rowCount !== 1 || updated.rows[0] === undefined) {
        throw new IntegrationLifecycleError('Integration cancellation could not be persisted');
      }
      return statusFromRow(updated.rows[0]);
    });
  }

  async handleCallback(
    profileInput: TrustedIntegrationProfile,
    input: IntegrationCallbackInput
  ): Promise<IntegrationStatus> {
    const profile = requireProfile(profileInput);
    const callbackId = requireText(input.callbackId, 'callbackId');
    const providerId = requireText(input.providerRequestId, 'providerRequestId');
    const occurredAt = iso(input.occurredAt, 'callback occurredAt');
    const reason = input.reason === undefined ? null : requireText(input.reason, 'callback reason', 500);
    const normalizedInput = { ...input, callbackId, providerRequestId: providerId, occurredAt, ...(reason === null ? {} : { reason }) };
    const fingerprint = callbackFingerprint(normalizedInput);

    return this.transaction(async (client) => {
      const row = await this.lockByProvider(client, profile.profileId, providerId);
      const callbackInsert = await client.query<CallbackRow>(
        `INSERT INTO integration_delivery_callbacks (
           profile_id, callback_id, logical_operation_id, semantic_fingerprint, received_at
         ) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (profile_id, callback_id) DO NOTHING
         RETURNING logical_operation_id, semantic_fingerprint`,
        [profile.profileId, callbackId, row.logical_operation_id, fingerprint]
      );

      if (callbackInsert.rowCount === 0) {
        const existing = await client.query<CallbackRow>(
          `SELECT logical_operation_id, semantic_fingerprint
             FROM integration_delivery_callbacks
            WHERE profile_id = $1 AND callback_id = $2`,
          [profile.profileId, callbackId]
        );
        const prior = existing.rows[0];
        if (
          existing.rowCount !== 1 ||
          prior === undefined ||
          prior.logical_operation_id !== row.logical_operation_id ||
          prior.semantic_fingerprint !== fingerprint
        ) {
          throw new IntegrationLifecycleError('Callback id was replayed with different semantics');
        }
        return statusFromRow(row);
      }

      if (row.state === input.state) return statusFromRow(row);
      if (TERMINAL_STATES.has(row.state)) {
        throw new IntegrationLifecycleError(`Callback cannot transition delivery from terminal ${row.state}`);
      }
      if (new Date(occurredAt).getTime() < new Date(rowIso(row.updated_at, 'updated_at')).getTime()) {
        throw new IntegrationLifecycleError('Callback timestamp is older than current delivery state');
      }

      const updated = await client.query<DeliveryRow>(
        `UPDATE integration_deliveries
            SET state = $3, reason = $4, updated_at = $5::timestamptz
          WHERE logical_operation_id = $1 AND profile_id = $2
          RETURNING *`,
        [row.logical_operation_id, profile.profileId, input.state, reason, occurredAt]
      );
      if (updated.rowCount !== 1 || updated.rows[0] === undefined) {
        throw new IntegrationLifecycleError('Integration callback state could not be persisted');
      }
      return statusFromRow(updated.rows[0]);
    });
  }

  private async lockByOperation(client: PostgresClient, profileId: string, logicalOperationId: string): Promise<DeliveryRow> {
    const result = await client.query<DeliveryRow>(
      `SELECT * FROM integration_deliveries
        WHERE logical_operation_id = $1 AND profile_id = $2
        FOR UPDATE`,
      [logicalOperationId, profileId]
    );
    if (result.rowCount !== 1 || result.rows[0] === undefined) {
      throw new IntegrationLifecycleError('Integration delivery was not found');
    }
    return result.rows[0];
  }

  private async lockByProvider(client: PostgresClient, profileId: string, providerId: string): Promise<DeliveryRow> {
    const result = await client.query<DeliveryRow>(
      `SELECT * FROM integration_deliveries
        WHERE profile_id = $1 AND provider_request_id = $2
        FOR UPDATE`,
      [profileId, providerId]
    );
    if (result.rowCount !== 1 || result.rows[0] === undefined) {
      throw new IntegrationLifecycleError('Integration delivery was not found');
    }
    return result.rows[0];
  }

  private async transaction<T>(work: (client: PostgresClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
