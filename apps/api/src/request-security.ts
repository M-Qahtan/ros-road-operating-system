import { randomUUID } from 'node:crypto';
import { ServerResponse } from 'node:http';

const TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
