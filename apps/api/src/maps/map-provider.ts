const MAX_PROVIDER_ID_CHARACTERS = 80;
const MAX_ROUTE_TTL_MS = 120_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 30_000;

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export type RoutingPreference = 'TRAFFIC_UNAWARE' | 'TRAFFIC_AWARE';

export interface AdvisoryRouteRequest {
  readonly origin: GeoPoint;
  readonly destination: GeoPoint;
  readonly routingPreference: RoutingPreference;
}

export interface AdvisoryRouteSnapshot {
  readonly providerId: string;
  readonly status: 'OK' | 'DEGRADED';
  readonly observedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly distanceMeters?: number;
  readonly durationSeconds?: number;
  readonly encodedPolyline?: string;
  readonly degradedReason?: string;
}

export interface MapProviderPort {
  readonly providerId: string;
  computeAdvisoryRoute(request: AdvisoryRouteRequest): Promise<AdvisoryRouteSnapshot>;
}

export class MapProviderBoundaryError extends Error {
  override readonly name = 'MapProviderBoundaryError';
}

function asRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MapProviderBoundaryError(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(record: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new MapProviderBoundaryError(`${label} contains unsupported field ${unknown[0]}`);
  }
}

function finiteCoordinate(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new MapProviderBoundaryError(`${label} is outside the supported coordinate range`);
  }
  return value;
}

function parseGeoPoint(value: unknown, label: string): GeoPoint {
  const record = asRecord(value, label);
  assertExactKeys(record, ['latitude', 'longitude'], label);
  return Object.freeze({
    latitude: finiteCoordinate(record.latitude, `${label}.latitude`, -90, 90),
    longitude: finiteCoordinate(record.longitude, `${label}.longitude`, -180, 180)
  });
}

export function parseMinimumNecessaryRouteRequest(value: unknown): AdvisoryRouteRequest {
  const record = asRecord(value, 'route request');
  assertExactKeys(record, ['origin', 'destination', 'routingPreference'], 'route request');
  if (record.routingPreference !== 'TRAFFIC_UNAWARE' && record.routingPreference !== 'TRAFFIC_AWARE') {
    throw new MapProviderBoundaryError('routingPreference is unsupported');
  }
  return Object.freeze({
    origin: parseGeoPoint(record.origin, 'origin'),
    destination: parseGeoPoint(record.destination, 'destination'),
    routingPreference: record.routingPreference
  });
}

function canonicalProviderId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_PROVIDER_ID_CHARACTERS || !/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed)) {
    throw new MapProviderBoundaryError('providerId is malformed');
  }
  return trimmed;
}

function safeNonNegativeInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new MapProviderBoundaryError(`${label} is invalid`);
  return value;
}

function safeNonNegativeFinite(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) throw new MapProviderBoundaryError(`${label} is invalid`);
  return value;
}

function canonicalPolyline(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length < 1 || value.length > 100_000) throw new MapProviderBoundaryError('encodedPolyline is invalid');
  return value;
}

function degraded(providerId: string, nowEpochMs: number, reason: string): AdvisoryRouteSnapshot {
  return Object.freeze({
    providerId,
    status: 'DEGRADED' as const,
    observedAtEpochMs: nowEpochMs,
    expiresAtEpochMs: nowEpochMs,
    degradedReason: reason
  });
}

function validateSnapshot(snapshot: AdvisoryRouteSnapshot, expectedProviderId: string, nowEpochMs: number): AdvisoryRouteSnapshot {
  if (canonicalProviderId(snapshot.providerId) !== expectedProviderId) {
    throw new MapProviderBoundaryError('provider response identity mismatch');
  }
  if (!Number.isSafeInteger(snapshot.observedAtEpochMs) || !Number.isSafeInteger(snapshot.expiresAtEpochMs)) {
    throw new MapProviderBoundaryError('provider response time is invalid');
  }
  if (snapshot.observedAtEpochMs > nowEpochMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new MapProviderBoundaryError('provider response time is too far in the future');
  }
  if (snapshot.expiresAtEpochMs < snapshot.observedAtEpochMs || snapshot.expiresAtEpochMs - snapshot.observedAtEpochMs > MAX_ROUTE_TTL_MS) {
    throw new MapProviderBoundaryError('provider response TTL is invalid');
  }
  if (snapshot.status === 'DEGRADED') return degraded(expectedProviderId, nowEpochMs, snapshot.degradedReason ?? 'provider reported degraded state');
  if (snapshot.status !== 'OK') throw new MapProviderBoundaryError('provider response status is invalid');
  if (snapshot.expiresAtEpochMs <= nowEpochMs) return degraded(expectedProviderId, nowEpochMs, 'provider response is stale');

  const distanceMeters = safeNonNegativeInteger(snapshot.distanceMeters, 'distanceMeters');
  const durationSeconds = safeNonNegativeFinite(snapshot.durationSeconds, 'durationSeconds');
  if (distanceMeters === undefined || durationSeconds === undefined) {
    throw new MapProviderBoundaryError('provider response is missing required route metrics');
  }
  const encodedPolyline = canonicalPolyline(snapshot.encodedPolyline);
  return Object.freeze({
    providerId: expectedProviderId,
    status: 'OK' as const,
    observedAtEpochMs: snapshot.observedAtEpochMs,
    expiresAtEpochMs: snapshot.expiresAtEpochMs,
    distanceMeters,
    durationSeconds,
    ...(encodedPolyline === undefined ? {} : { encodedPolyline })
  });
}

/**
 * Converts any provider failure or stale/malformed result into a bounded advisory DEGRADED state.
 * This function never mutates RoadEvent state or grants S3/S4 authority.
 */
export async function computeAdvisoryRouteSafely(
  provider: MapProviderPort,
  request: AdvisoryRouteRequest,
  nowEpochMs: number = Date.now()
): Promise<AdvisoryRouteSnapshot> {
  const providerId = canonicalProviderId(provider.providerId);
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) throw new MapProviderBoundaryError('trusted time is invalid');
  try {
    return validateSnapshot(await provider.computeAdvisoryRoute(request), providerId, nowEpochMs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'map provider failure';
    return degraded(providerId, nowEpochMs, reason.slice(0, 240));
  }
}
