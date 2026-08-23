import {
  AdvisoryRouteRequest,
  AdvisoryRouteSnapshot,
  MapProviderBoundaryError,
  MapProviderPort
} from './map-provider.js';

const GOOGLE_COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const GOOGLE_FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_TTL_MS = 30_000;

export interface GoogleMapsApiKeyProvider {
  resolveApiKey(): Promise<string>;
}

export interface GoogleRoutesSandboxProviderOptions {
  readonly fetchImpl?: typeof fetch;
  readonly nowEpochMs?: () => number;
  readonly timeoutMs?: number;
  readonly ttlMs?: number;
}

function canonicalApiKey(value: string): string {
  if (value !== value.trim() || value.length < 20 || value.length > 256 || /\s/.test(value)) {
    throw new MapProviderBoundaryError('Google Maps API key is malformed');
  }
  return value;
}

function boundedPositiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new MapProviderBoundaryError(`${label} is outside the supported bound`);
  }
  return value;
}

function asRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MapProviderBoundaryError(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function parseDurationSeconds(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,9})?s$/.test(value)) {
    throw new MapProviderBoundaryError('Google route duration is malformed');
  }
  const seconds = Number(value.slice(0, -1));
  if (!Number.isFinite(seconds) || seconds < 0) throw new MapProviderBoundaryError('Google route duration is invalid');
  return seconds;
}

function parseDistanceMeters(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new MapProviderBoundaryError('Google route distance is invalid');
  }
  return value;
}

function parseEncodedPolyline(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const polyline = asRecord(value, 'Google route polyline');
  const encoded = polyline.encodedPolyline;
  if (typeof encoded !== 'string' || encoded.length < 1 || encoded.length > 100_000) {
    throw new MapProviderBoundaryError('Google encoded polyline is invalid');
  }
  return encoded;
}

function parseGoogleRouteResponse(value: unknown): {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly encodedPolyline?: string;
} {
  const root = asRecord(value, 'Google route response');
  if (!Array.isArray(root.routes) || root.routes.length !== 1) {
    throw new MapProviderBoundaryError('Google route response must contain exactly one primary route');
  }
  const route = asRecord(root.routes[0], 'Google primary route');
  const encodedPolyline = parseEncodedPolyline(route.polyline);
  return Object.freeze({
    distanceMeters: parseDistanceMeters(route.distanceMeters),
    durationSeconds: parseDurationSeconds(route.duration),
    ...(encodedPolyline === undefined ? {} : { encodedPolyline })
  });
}

export class GoogleRoutesSandboxProvider implements MapProviderPort {
  readonly providerId = 'google-routes-sandbox';
  private readonly fetchImpl: typeof fetch;
  private readonly nowEpochMs: () => number;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;

  constructor(
    private readonly apiKeyProvider: GoogleMapsApiKeyProvider,
    options: GoogleRoutesSandboxProviderOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nowEpochMs = options.nowEpochMs ?? Date.now;
    this.timeoutMs = boundedPositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'Google route timeout', 10_000);
    this.ttlMs = boundedPositiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, 'Google route TTL', 120_000);
  }

  async computeAdvisoryRoute(request: AdvisoryRouteRequest): Promise<AdvisoryRouteSnapshot> {
    const apiKey = canonicalApiKey(await this.apiKeyProvider.resolveApiKey());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(GOOGLE_COMPUTE_ROUTES_URL, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
          'x-goog-fieldmask': GOOGLE_FIELD_MASK
        },
        body: JSON.stringify({
          origin: { location: { latLng: request.origin } },
          destination: { location: { latLng: request.destination } },
          travelMode: 'DRIVE',
          routingPreference: request.routingPreference
        })
      });

      if (!response.ok) throw new MapProviderBoundaryError(`Google Routes returned HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new MapProviderBoundaryError('Google Routes returned non-JSON content');
      }
      const declaredLength = response.headers.get('content-length');
      if (declaredLength !== null) {
        const parsedLength = Number(declaredLength);
        if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_RESPONSE_BYTES) {
          throw new MapProviderBoundaryError('Google Routes response exceeds the allowed size');
        }
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new MapProviderBoundaryError('Google Routes response exceeds the allowed size');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new MapProviderBoundaryError('Google Routes returned malformed JSON');
      }
      const route = parseGoogleRouteResponse(parsed);
      const observedAtEpochMs = this.nowEpochMs();
      if (!Number.isSafeInteger(observedAtEpochMs) || observedAtEpochMs < 0) {
        throw new MapProviderBoundaryError('trusted map-provider time is invalid');
      }
      return Object.freeze({
        providerId: this.providerId,
        status: 'OK' as const,
        observedAtEpochMs,
        expiresAtEpochMs: observedAtEpochMs + this.ttlMs,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        ...(route.encodedPolyline === undefined ? {} : { encodedPolyline: route.encodedPolyline })
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
