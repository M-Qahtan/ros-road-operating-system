export function buildMobileSecurityHeaders(apiOrigin: string): Readonly<Record<string, string>> {
  const origin = validatedOrigin(apiOrigin);
  return Object.freeze({
    'content-security-policy': `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; connect-src 'self' ${origin}; style-src 'self'; script-src 'self'`,
    'permissions-policy': 'geolocation=(self), camera=(), microphone=()',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
}

function validatedOrigin(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new TypeError('Mobile API origin is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== raw || url.username !== '' || url.password !== '') {
    throw new TypeError('Mobile API origin must be a credential-free HTTP(S) origin');
  }
  return url.origin;
}
