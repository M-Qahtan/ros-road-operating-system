import {
  DeliveryMetrics,
  EventBroker,
  NullDeliveryMetrics,
  OutboxMessage,
  OutboxRepository
} from './outbox-types.js';

export interface OutboxWorkerOptions {
  readonly workerId: string;
  readonly batchSize: number;
  readonly lockDurationMs: number;
  readonly maximumAttempts: number;
  readonly baseRetryDelayMs: number;
  readonly maximumRetryDelayMs: number;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export interface OutboxRunResult {
  readonly claimed: number;
  readonly published: number;
  readonly retried: number;
  readonly deadLettered: number;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${field} must be a positive safe integer`);
  return value;
}

function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().replace(/\s+/g, ' ');
  return (normalized.length === 0 ? 'unknown delivery failure' : normalized).slice(0, 1_000);
}

export function calculateRetryDelayMs(
  retryCount: number,
  baseDelayMs: number,
  maximumDelayMs: number,
  random: () => number = Math.random
): number {
  requirePositiveInteger(retryCount, 'retryCount');
  requirePositiveInteger(baseDelayMs, 'baseDelayMs');
  requirePositiveInteger(maximumDelayMs, 'maximumDelayMs');
  if (baseDelayMs > maximumDelayMs) throw new RangeError('baseDelayMs cannot exceed maximumDelayMs');

  const exponent = Math.min(retryCount - 1, 30);
  const uncapped = baseDelayMs * (2 ** exponent);
  const capped = Math.min(uncapped, maximumDelayMs);
  const jitter = 0.5 + Math.min(Math.max(random(), 0), 1) * 0.5;
  return Math.max(1, Math.floor(capped * jitter));
}

export class OutboxWorker {
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(
    private readonly repository: OutboxRepository,
    private readonly broker: EventBroker,
    private readonly options: OutboxWorkerOptions,
    private readonly metrics: DeliveryMetrics = new NullDeliveryMetrics()
  ) {
    if (options.workerId.trim().length === 0 || options.workerId.length > 128) {
      throw new TypeError('workerId must contain between 1 and 128 characters');
    }
    requirePositiveInteger(options.batchSize, 'batchSize');
    requirePositiveInteger(options.lockDurationMs, 'lockDurationMs');
    requirePositiveInteger(options.maximumAttempts, 'maximumAttempts');
    requirePositiveInteger(options.baseRetryDelayMs, 'baseRetryDelayMs');
    requirePositiveInteger(options.maximumRetryDelayMs, 'maximumRetryDelayMs');
    if (options.baseRetryDelayMs > options.maximumRetryDelayMs) {
      throw new RangeError('baseRetryDelayMs cannot exceed maximumRetryDelayMs');
    }
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  async runOnce(): Promise<OutboxRunResult> {
    const messages = await this.repository.claimBatch(
      this.options.workerId,
      this.options.batchSize,
      this.options.lockDurationMs
    );
    this.metrics.claimed(messages.length);

    let published = 0;
    let retried = 0;
    let deadLettered = 0;
    for (const message of messages) {
      try {
        await this.broker.publish(message);
        const publishedAt = this.now();
        await this.repository.markPublished(message.id, this.options.workerId, publishedAt);
        this.metrics.published(message);
        published += 1;
      } catch (error) {
        const attempt = message.retryCount + 1;
        const failedAt = this.now();
        const isDeadLetter = attempt >= this.options.maximumAttempts;
        const delayMs = calculateRetryDelayMs(
          attempt,
          this.options.baseRetryDelayMs,
          this.options.maximumRetryDelayMs,
          this.random
        );
        const nextAttemptAt = new Date(failedAt.getTime() + delayMs);
        await this.repository.markFailed(
          message.id,
          this.options.workerId,
          normalizeError(error),
          nextAttemptAt,
          ...(isDeadLetter ? [failedAt] : [])
        );
        if (isDeadLetter) {
          this.metrics.deadLettered(message);
          deadLettered += 1;
        } else {
          this.metrics.retried(message, nextAttemptAt);
          retried += 1;
        }
      }
    }

    return { claimed: messages.length, published, retried, deadLettered };
  }
}
