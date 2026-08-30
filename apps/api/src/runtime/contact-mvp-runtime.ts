import { createHash } from 'node:crypto';
import {
  ContactChannelPort,
  ContactOrchestrationService,
  ContactRuntimeRepositoryPort,
  RuntimeIdFactoryPort
} from '../ros-eye/contact-orchestration.js';
import { syntheticStagingEnabled } from './synthetic-staging-profile.js';

const DEFAULT_IDLE_POLL_MS = 250;
const DEFAULT_BATCH_SIZE = 25;

export interface ContactMvpRuntimeOptions {
  readonly workerId: string;
  readonly idlePollMs: number;
  readonly batchSize: number;
}

export interface ContactMvpRuntimeDependencies {
  readonly channel?: ContactChannelPort;
  readonly ids?: RuntimeIdFactoryPort;
  readonly now?: () => Date;
}

export interface ContactMvpRunResult {
  readonly sessionsProcessed: number;
  readonly messagesProcessed: number;
}

export class ContactMvpRuntimeConfigurationError extends Error {
  override readonly name = 'ContactMvpRuntimeConfigurationError';
}

function boundedInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new ContactMvpRuntimeConfigurationError(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ContactMvpRuntimeConfigurationError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function readContactMvpRuntimeOptions(environment: NodeJS.ProcessEnv): ContactMvpRuntimeOptions {
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  const configuredWorkerId = environment.ROS_CONTACT_WORKER_ID?.trim();
  if ((nodeEnvironment === 'production' || nodeEnvironment === 'staging') && !configuredWorkerId) {
    throw new ContactMvpRuntimeConfigurationError('ROS_CONTACT_WORKER_ID is required outside development/test');
  }
  const workerId = configuredWorkerId ?? 'local-contact-worker';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(workerId)) {
    throw new ContactMvpRuntimeConfigurationError('ROS_CONTACT_WORKER_ID is invalid');
  }
  return Object.freeze({
    workerId,
    idlePollMs: boundedInteger(environment, 'ROS_CONTACT_IDLE_POLL_MS', DEFAULT_IDLE_POLL_MS, 25, 60_000),
    batchSize: boundedInteger(environment, 'ROS_CONTACT_BATCH_SIZE', DEFAULT_BATCH_SIZE, 1, 500)
  });
}

class StableContactIdFactory implements RuntimeIdFactoryPort {
  async create(namespace: string, material: string): Promise<string> {
    const digest = createHash('sha256').update(`${namespace}|${material}`).digest('hex');
    return `mvp-${namespace.slice(0, 24)}-${digest}`;
  }
}

/**
 * Staging-only in-app delivery acknowledgement. It sends no external message
 * and makes no dispatch claim; the authenticated Field Companion is the
 * consumer of the durable prompt/session state.
 */
class StagingInAppContactChannel implements ContactChannelPort {
  async send(input: Parameters<ContactChannelPort['send']>[0]): Promise<'SENT' | 'UNAVAILABLE'> {
    return input.channel === 'IN_APP' ? 'SENT' : 'UNAVAILABLE';
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(finish, milliseconds);
    const onAbort = () => finish();
    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class ContactMvpRuntime {
  readonly service: ContactOrchestrationService;
  private readonly now: () => Date;

  constructor(
    repository: ContactRuntimeRepositoryPort,
    channel: ContactChannelPort,
    ids: RuntimeIdFactoryPort,
    private readonly options: ContactMvpRuntimeOptions,
    now: () => Date = () => new Date()
  ) {
    this.service = new ContactOrchestrationService(repository, channel, ids);
    this.now = now;
  }

  async runOnce(): Promise<ContactMvpRunResult> {
    const at = this.now().toISOString();
    const sessions = await this.service.runDue(this.options.workerId, at, this.options.batchSize);
    const messages = await this.service.runOutbox(this.options.workerId, at, this.options.batchSize);
    return { sessionsProcessed: sessions.length, messagesProcessed: messages.length };
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const result = await this.runOnce();
      if (result.sessionsProcessed === 0 && result.messagesProcessed === 0) {
        await delay(this.options.idlePollMs, signal);
      }
    }
  }
}

export function createContactMvpRuntime(
  repository: ContactRuntimeRepositoryPort,
  environment: NodeJS.ProcessEnv,
  dependencies: ContactMvpRuntimeDependencies = {}
): ContactMvpRuntime {
  const production = (environment.NODE_ENV ?? 'development').trim().toLowerCase() === 'production';
  const syntheticStaging = syntheticStagingEnabled(environment);
  const stagingInAppChannel = production && syntheticStaging &&
    environment.ROS_CONTACT_CHANNEL_PROFILE?.trim() === 'in-app-only';
  if (production && dependencies.channel === undefined && !stagingInAppChannel) {
    throw new ContactMvpRuntimeConfigurationError(
      'Production contact runtime requires an injected approved channel provider'
    );
  }
  return new ContactMvpRuntime(
    repository,
    dependencies.channel ?? new StagingInAppContactChannel(),
    dependencies.ids ?? new StableContactIdFactory(),
    readContactMvpRuntimeOptions(environment),
    dependencies.now
  );
}
