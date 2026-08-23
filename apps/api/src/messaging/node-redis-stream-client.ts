import { createClient } from 'redis';
import { RedisStreamClient } from './redis-stream-broker.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

export interface RedisRuntimeClient extends RedisStreamClient {
  connect(): Promise<void>;
  verifyConnection(): Promise<void>;
  close(): Promise<void>;
  readonly isReady: boolean;
}

export class RedisRuntimeConfigurationError extends Error {
  override readonly name = 'RedisRuntimeConfigurationError';
}

function integer(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new RedisRuntimeConfigurationError(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RedisRuntimeConfigurationError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function requiredRedisUrl(environment: NodeJS.ProcessEnv): string {
  const raw = environment.REDIS_URL?.trim();
  if (!raw) throw new RedisRuntimeConfigurationError('REDIS_URL is required');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RedisRuntimeConfigurationError('REDIS_URL is invalid');
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new RedisRuntimeConfigurationError('REDIS_URL must use redis:// or rediss://');
  }
  if (!url.hostname) throw new RedisRuntimeConfigurationError('REDIS_URL must include a hostname');
  if (url.hash) throw new RedisRuntimeConfigurationError('REDIS_URL must not include a fragment');
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  if (nodeEnvironment === 'production' && url.protocol !== 'rediss:') {
    throw new RedisRuntimeConfigurationError('Production REDIS_URL must use rediss:// TLS');
  }
  return raw;
}

export function buildRedisRuntimeOptions(environment: NodeJS.ProcessEnv) {
  const url = requiredRedisUrl(environment);
  const connectTimeout = integer(
    environment,
    'REDIS_CONNECT_TIMEOUT_MS',
    DEFAULT_CONNECT_TIMEOUT_MS,
    100,
    60_000
  );
  const maximumReconnectAttempts = integer(
    environment,
    'REDIS_MAX_RECONNECT_ATTEMPTS',
    DEFAULT_MAX_RECONNECT_ATTEMPTS,
    0,
    100
  );
  return {
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout,
      reconnectStrategy(retries: number): number | Error {
        if (retries >= maximumReconnectAttempts) {
          return new Error('Redis reconnect attempt limit reached');
        }
        return Math.min(100 * (2 ** retries), 3_000);
      }
    }
  } as const;
}

export class NodeRedisStreamClient implements RedisRuntimeClient {
  private readonly client: ReturnType<typeof createClient>;

  constructor(environment: NodeJS.ProcessEnv) {
    this.client = createClient(buildRedisRuntimeOptions(environment));
    this.client.on('error', () => {
      // Connection errors are surfaced by readiness and command failures.
      // Never log a URL because it can contain Redis credentials.
    });
  }

  get isReady(): boolean {
    return this.client.isReady;
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) await this.client.connect();
    if (!this.client.isReady) throw new Error('Redis client connected but is not ready');
  }

  async verifyConnection(): Promise<void> {
    if (!this.client.isReady) throw new Error('Redis runtime client is not ready');
    const response = await this.client.ping();
    if (response !== 'PONG') throw new Error('Redis PING did not return PONG');
  }

  async xadd(stream: string, id: '*', fields: Readonly<Record<string, string>>): Promise<string> {
    if (!this.client.isReady) throw new Error('Redis stream client is not ready');
    const result = await this.client.xAdd(stream, id, { ...fields });
    if (typeof result !== 'string' || result.length === 0) {
      throw new Error('Redis XADD did not return a stream entry id');
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.client.isOpen) this.client.destroy();
  }
}

export function createNodeRedisStreamClient(environment: NodeJS.ProcessEnv): RedisRuntimeClient {
  return new NodeRedisStreamClient(environment);
}
