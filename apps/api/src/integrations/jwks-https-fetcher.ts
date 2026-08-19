import { JwksDocumentFetcherPort, JwksProviderError } from './jwks-key-provider.js';

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_BODY_BYTES = 128 * 1024;

export interface JwksHttpResponsePort {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type JwksHttpFetchPort = (
  url: string,
  init: {
    readonly method: 'GET';
    readonly redirect: 'error';
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  }
) => Promise<JwksHttpResponsePort>;

export interface HttpsJwksFetcherOptions {
  readonly timeoutMs?: number;
  readonly maximumBodyBytes?: number;
  readonly fetch?: JwksHttpFetchPort;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new JwksProviderError(`${field} must be a positive safe integer`);
  }
  return value;
}

function trustedHttpsUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new JwksProviderError('OIDC JWKS URL is invalid');
  }
  if (url.protocol !== 'https:') throw new JwksProviderError('OIDC JWKS URL must use HTTPS');
  if (!url.hostname) throw new JwksProviderError('OIDC JWKS URL must include a hostname');
  if (url.username || url.password) throw new JwksProviderError('OIDC JWKS URL must not contain credentials');
  if (url.hash) throw new JwksProviderError('OIDC JWKS URL must not contain a fragment');
  return url.toString();
}

const defaultFetch: JwksHttpFetchPort = async (url, init) => fetch(url, init);

/**
 * Fetches a single configured JWKS trust anchor. Redirects are rejected so the
 * configured HTTPS origin remains the authority boundary. Tests inject a fake
 * fetch implementation; constructing this class never performs network I/O.
 */
export class HttpsJwksDocumentFetcher implements JwksDocumentFetcherPort {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maximumBodyBytes: number;
  private readonly httpFetch: JwksHttpFetchPort;

  constructor(rawUrl: string, options: HttpsJwksFetcherOptions = {}) {
    this.url = trustedHttpsUrl(rawUrl);
    this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'JWKS timeoutMs');
    this.maximumBodyBytes = positiveInteger(
      options.maximumBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      'JWKS maximumBodyBytes'
    );
    this.httpFetch = options.fetch ?? defaultFetch;
  }

  async fetchJwks(): Promise<unknown> {
    let response: JwksHttpResponsePort;
    try {
      response = await this.httpFetch(this.url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/jwk-set+json, application/json'
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new JwksProviderError('JWKS HTTPS request failed');
    }

    if (!response.ok) {
      throw new JwksProviderError(`JWKS HTTPS request returned status ${response.status}`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('json')) {
      throw new JwksProviderError('JWKS HTTPS response must be JSON');
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const parsed = Number(contentLength);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > this.maximumBodyBytes) {
        throw new JwksProviderError('JWKS HTTPS response exceeds the configured size limit');
      }
    }

    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > this.maximumBodyBytes) {
      throw new JwksProviderError('JWKS HTTPS response exceeds the configured size limit');
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new JwksProviderError('JWKS HTTPS response is not valid JSON');
    }
  }
}
