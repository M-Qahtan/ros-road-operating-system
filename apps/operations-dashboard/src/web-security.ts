export function dashboardSecurityHeaders(apiOrigin: string): Readonly<Record<string, string>> {
  return Object.freeze({
    'cache-control': 'no-store',
    'content-security-policy': [
      "default-src 'self'",
      `connect-src 'self' ${apiOrigin}`,
      "style-src 'self'",
      "script-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'"
    ].join('; '),
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), camera=(), microphone=()'
  });
}
