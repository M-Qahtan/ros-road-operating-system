import { createClient } from 'redis';
import { RedisStreamClient } from './redis-stream-broker.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

export interface RedisRuntimeClient extends RedisStreamClient {
  connect(signal?: AbortSignal): Promise<void>;
  verifyConnection(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
  readonly isReady: boolean;
}

export class RedisRuntimeConfigurationError extends Error {
  override readonly name = 'RedisRuntimeConfigurationError';
}

interface NodeRedisClientPort {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  connect(): Promise<unknown>;
  ping(): Promise<string>;
  xAdd(stream: string, id: '*', fields: Record<string, string>): Promise<string | null>;
  withAbortSignal?(signal: AbortSignal): Pick<NodeRedisClientPort, 'xAdd'>;
  destroy(): void;
}

export interface NodeRedisStreamClientDependencies {
  readonly createClient?: (options: ReturnType<typeof buildRedisRuntimeOptions>) => NodeRedisClientPort;
}

function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Redis operation aborted');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal);
}

function awaitWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => finish(() => reject(aborted(signal)));
    const finish = (settle: () => void) => {
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
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
  private readonly client: NodeRedisClientPort;
  private connectInFlight: Promise<void> | null = null;
  private closeInFlight: Promise<void> | null = null;
  private closing = false;

  constructor(environment: NodeJS.ProcessEnv, dependencies: NodeRedisStreamClientDependencies = {}) {
    const clientFactory = dependencies.createClient ?? createClient;
    this.client = clientFactory(buildRedisRuntimeOptions(environment));
    this.client.on('error', () => {
      // Connection errors are surfaced by readiness and command failures.
      // Never log a URL because it can contain Redis credentials.
    });
  }

  get isReady(): boolean {
    return this.client.isReady;
  }

  private startConnect(): Promise<void> {
    const attempt = Promise.resolve()
      .then(async () => {
        if (this.closing) throw new Error('Redis runtime client is closing');
        await this.client.connect();
      });
    this.connectInFlight = attempt;
    const clear = () => {
      if (this.connectInFlight === attempt) this.connectInFlight = null;
    };
    void attempt.then(clear, clear);
    return attempt;
  }

  private async ensureConnected(signal?: AbortSignal): Promise<void> {
    if (this.closing) throw new Error('Redis runtime client is closing');
    throwIfAborted(signal);
    if (this.client.isReady) return;
    const activeAttempt = this.connectInFlight;
    if (activeAttempt !== null) await awaitWithAbort(activeAttempt, signal);
    else if (!this.client.isOpen) await awaitWithAbort(this.startConnect(), signal);
    if (this.closing) throw new Error('Redis runtime client is closing');
    throwIfAborted(signal);
    if (!this.client.isReady) throw new Error('Redis client connected but is not ready');
  }

  async connect(signal?: AbortSignal): Promise<void> {
    await this.ensureConnected(signal);
  }

  async verifyConnection(signal?: AbortSignal): Promise<void> {
    // The configured reconnect strategy is deliberately bounded. Once it is
    // exhausted node-redis closes the socket; a later readiness probe starts
    // one fresh, coalesced connection attempt so a recovered dependency does
    // not leave the process permanently not-ready.
    await this.ensureConnected(signal);
    const response = await awaitWithAbort(this.client.ping(), signal);
    if (response !== 'PONG') throw new Error('Redis PING did not return PONG');
  }

  async xadd(
    stream: string,
    id: '*',
    fields: Readonly<Record<string, string>>,
    signal?: AbortSignal
  ): Promise<string> {
    // Reconnection is performed by the worker runtime before it claims an
    // outbox lease. Never start a potentially long connection cycle after a
    // row is claimed because another worker could reclaim an expired lease.
    if (this.closing) throw new Error('Redis runtime client is closing');
    if (!this.client.isReady) throw new Error('Redis stream client is not ready');
    throwIfAborted(signal);
    const commandClient = signal === undefined
      ? this.client
      : this.client.withAbortSignal?.(signal);
    if (commandClient === undefined) {
      throw new Error('Redis client does not support abortable commands');
    }
    const interruptTransport = () => {
      // node-redis removes its command abort listener after the command moves
      // from the write queue to the reply queue. Destroying the socket is the
      // only bounded cancellation once XADD may already be on the wire.
      if (!this.client.isOpen) return;
      try { this.client.destroy(); } catch { /* The command promise remains authoritative. */ }
    };
    signal?.addEventListener('abort', interruptTransport, { once: true });
    let result: string | null;
    try {
      result = await commandClient.xAdd(stream, id, { ...fields });
    } finally {
      signal?.removeEventListener('abort', interruptTransport);
    }
    if (typeof result !== 'string' || result.length === 0) {
      throw new Error('Redis XADD did not return a stream entry id');
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.closeInFlight !== null) return this.closeInFlight;
    this.closing = true;
    // node-redis destroy() synchronously interrupts a pending connect/reconnect.
    // Cancellation happens before awaiting the tracked attempt so shutdown is
    // not serialized behind the full reconnect budget.
    const activeAttempt = this.connectInFlight;
    if (this.client.isOpen) this.client.destroy();
    this.closeInFlight = activeAttempt?.catch(() => undefined) ?? Promise.resolve();
    return this.closeInFlight;
  }
}

export function createNodeRedisStreamClient(environment: NodeJS.ProcessEnv): RedisRuntimeClient {
  return new NodeRedisStreamClient(environment);
}
