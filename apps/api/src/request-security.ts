import { randomUUID } from 'node:crypto';
import { ServerResponse } from 'node:http';

const TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CORS_ALLOWED_METHODS = new Set(['GET', 'POST', 'OPTIONS']);
const CORS_ALLOWED_HEADERS = new Set([
  'authorization', 'content-type', 'idempotency-key', 'x-device-id', 'x-tenant-id', 'x-purpose', 'x-trace-id'
]);
const MAX_CORS_ORIGINS = 16;

export interface CorsPolicy { readonly allowedOrigins: ReadonlySet<string>; }

export function resolveTraceId(candidate: string | readonly string[] | undefined): string {
  if (typeof candidate === 'string' && TRACE_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  return randomUUID();
}

export function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
}

export function createCorsPolicy(environment: NodeJS.ProcessEnv): CorsPolicy {
  const raw = environment.ROS_CORS_ALLOWED_ORIGINS?.trim();
  if (raw === undefined || raw === '') return { allowedOrigins: new Set() };
  const production = (environment.NODE_ENV ?? 'development').trim().toLowerCase() === 'production';
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.length > MAX_CORS_ORIGINS || new Set(values).size !== values.length) {
    throw new Error(`ROS_CORS_ALLOWED_ORIGINS must contain 1-${MAX_CORS_ORIGINS} unique origins`);
  }
  const origins = values.map((value) => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('ROS_CORS_ALLOWED_ORIGINS contains an invalid URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== value) {
      throw new Error('ROS_CORS_ALLOWED_ORIGINS entries must be credential-free canonical origins');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (production && url.protocol !== 'https:') throw new Error('Production CORS origins must use HTTPS');
    if (!production && url.protocol === 'http:' && !local) throw new Error('Non-production HTTP CORS origins are restricted to loopback hosts');
    return url.origin;
  });
  return { allowedOrigins: new Set(origins) };
}

export function applyCorsHeaders(response: ServerResponse, origin: string | undefined, policy: CorsPolicy): boolean {
  if (origin === undefined) return true;
  if (!policy.allowedOrigins.has(origin)) return false;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-methods', [...CORS_ALLOWED_METHODS].join(', '));
  response.setHeader('access-control-allow-headers', [...CORS_ALLOWED_HEADERS].join(', '));
  response.setHeader('access-control-max-age', '600');
  return true;
}

export function corsPreflightAllowed(
  requestedMethod: string | undefined,
  requestedHeaders: string | undefined
): boolean {
  if (requestedMethod === undefined || !CORS_ALLOWED_METHODS.has(requestedMethod.trim().toUpperCase())) return false;
  if (requestedHeaders === undefined || requestedHeaders.trim() === '') return true;
  const headers = requestedHeaders.split(',').map((value) => value.trim().toLowerCase());
  return headers.length <= CORS_ALLOWED_HEADERS.size && headers.every((header) => CORS_ALLOWED_HEADERS.has(header));
}
