import { JwksDocumentFetcherPort, JwksProviderError } from './jwks-key-provider.js';

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_BODY_BYTES = 128 * 1024;

export type JwksHttpFetchPort = (
  url: string,
  init: {
    readonly method: 'GET';
    readonly redirect: 'error';
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  }
) => Promise<Response>;

export interface HttpsJwksFetcherOptions {
  readonly timeoutMs?: number;
  readonly maximumBodyBytes?: number;
  readonly fetch?: JwksHttpFetchPort;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new JwksProviderError(`${field} must be a positive safe integer`);
  return value;
}

function trustedHttpsUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new JwksProviderError('OIDC JWKS URL is invalid'); }
  if (url.protocol !== 'https:') throw new JwksProviderError('OIDC JWKS URL must use HTTPS');
  if (!url.hostname) throw new JwksProviderError('OIDC JWKS URL must include a hostname');
  if (url.username || url.password) throw new JwksProviderError('OIDC JWKS URL must not contain credentials');
  if (url.hash) throw new JwksProviderError('OIDC JWKS URL must not contain a fragment');
  return url.toString();
}

const defaultFetch: JwksHttpFetchPort = async (url, init) => fetch(url, init);

async function readBoundedBody(response: Response, maximumBodyBytes: number): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBodyBytes) {
        await reader.cancel('JWKS response exceeds configured size limit');
        throw new JwksProviderError('JWKS HTTPS response exceeds the configured size limit');
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof JwksProviderError) throw error;
    throw new JwksProviderError('JWKS HTTPS response body could not be read safely');
  } finally {
    try { reader.releaseLock(); } catch { /* The reader may already be released/cancelled. */ }
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export class HttpsJwksDocumentFetcher implements JwksDocumentFetcherPort {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maximumBodyBytes: number;
  private readonly httpFetch: JwksHttpFetchPort;

  constructor(rawUrl: string, options: HttpsJwksFetcherOptions = {}) {
    this.url = trustedHttpsUrl(rawUrl);
    this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'JWKS timeoutMs');
    this.maximumBodyBytes = positiveInteger(options.maximumBodyBytes ?? DEFAULT_MAX_BODY_BYTES, 'JWKS maximumBodyBytes');
    this.httpFetch = options.fetch ?? defaultFetch;
  }

  async fetchJwks(): Promise<unknown> {
    let response: Response;
    try {
      response = await this.httpFetch(this.url, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/jwk-set+json, application/json' },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new JwksProviderError('JWKS HTTPS request failed');
    }
    if (!response.ok) throw new JwksProviderError(`JWKS HTTPS request returned status ${response.status}`);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('json')) throw new JwksProviderError('JWKS HTTPS response must be JSON');
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const parsed = Number(contentLength);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > this.maximumBodyBytes) {
        throw new JwksProviderError('JWKS HTTPS response exceeds the configured size limit');
      }
    }
    const body = await readBoundedBody(response, this.maximumBodyBytes);
    if (Buffer.byteLength(body, 'utf8') > this.maximumBodyBytes) {
      throw new JwksProviderError('JWKS HTTPS response exceeds the configured size limit');
    }
    try { return JSON.parse(body) as unknown; }
    catch { throw new JwksProviderError('JWKS HTTPS response is not valid JSON'); }
  }
}
