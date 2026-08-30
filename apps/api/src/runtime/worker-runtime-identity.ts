import { createHash } from 'node:crypto';

const ECS_METADATA_ORIGIN = 'http://169.254.170.2';
const MAX_METADATA_RESPONSE_BYTES = 16 * 1024;
const TASK_ARN = /^arn:(?:aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/(?:[A-Za-z0-9_-]{1,255}\/)?[0-9a-f]{32}$/;
const PREFIX = /^[A-Za-z0-9][A-Za-z0-9._-]{2,47}$/;

export type WorkerRuntimeRole = 'outbox' | 'contact';

export class WorkerRuntimeIdentityConfigurationError extends Error {
  override readonly name = 'WorkerRuntimeIdentityConfigurationError';
}

function taskMetadataUrl(environment: NodeJS.ProcessEnv): URL {
  const raw = environment.ECS_CONTAINER_METADATA_URI_V4?.trim();
  if (!raw || raw.length > 2048) {
    throw new WorkerRuntimeIdentityConfigurationError('ECS_CONTAINER_METADATA_URI_V4 is required');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WorkerRuntimeIdentityConfigurationError('ECS_CONTAINER_METADATA_URI_V4 is invalid');
  }
  if (
    url.origin !== ECS_METADATA_ORIGIN || url.username || url.password ||
    url.search || url.hash || !/^\/v4\/[A-Za-z0-9_-]+$/.test(url.pathname)
  ) {
    throw new WorkerRuntimeIdentityConfigurationError(
      'ECS_CONTAINER_METADATA_URI_V4 must use the trusted ECS v4 link-local endpoint'
    );
  }
  return new URL(`${url.href}/task`);
}

async function resolveTaskArn(environment: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<string> {
  const url = taskMetadataUrl(environment);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(2_000)
    });
  } catch {
    throw new WorkerRuntimeIdentityConfigurationError('ECS task metadata request failed');
  }
  if (!response.ok) {
    throw new WorkerRuntimeIdentityConfigurationError(`ECS task metadata returned status ${response.status}`);
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_METADATA_RESPONSE_BYTES)) {
    throw new WorkerRuntimeIdentityConfigurationError('ECS task metadata response is oversized');
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_METADATA_RESPONSE_BYTES) {
    throw new WorkerRuntimeIdentityConfigurationError('ECS task metadata response is oversized');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new WorkerRuntimeIdentityConfigurationError('ECS task metadata returned malformed JSON');
  }
  const taskArn = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { TaskARN?: unknown }).TaskARN
    : undefined;
  if (typeof taskArn !== 'string' || !TASK_ARN.test(taskArn)) {
    throw new WorkerRuntimeIdentityConfigurationError('ECS task metadata TaskARN is invalid');
  }
  return taskArn;
}

/**
 * Resolves one identity per ECS task and worker role. Explicit identities take
 * precedence for deterministic local/CI environments. Metadata resolution is
 * opt-in and restricted to the ECS v4 link-local endpoint.
 */
export async function resolveWorkerRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
  roles: readonly WorkerRuntimeRole[],
  fetchImpl: typeof fetch = fetch
): Promise<NodeJS.ProcessEnv> {
  const missing = roles.filter((role) => {
    const name = role === 'outbox' ? 'ROS_OUTBOX_WORKER_ID' : 'ROS_CONTACT_WORKER_ID';
    return !environment[name]?.trim();
  });
  if (missing.length === 0) return { ...environment };

  const source = environment.ROS_WORKER_ID_SOURCE?.trim();
  if (!source) return { ...environment };
  if (source !== 'ecs-task-metadata-v4') {
    throw new WorkerRuntimeIdentityConfigurationError('ROS_WORKER_ID_SOURCE is unsupported');
  }
  const prefix = environment.ROS_WORKER_ID_PREFIX?.trim();
  if (!prefix || !PREFIX.test(prefix)) {
    throw new WorkerRuntimeIdentityConfigurationError('ROS_WORKER_ID_PREFIX is invalid');
  }

  const taskArn = await resolveTaskArn(environment, fetchImpl);
  const taskDigest = createHash('sha256').update(taskArn, 'utf8').digest('hex').slice(0, 32);
  const resolved = { ...environment };
  for (const role of missing) {
    const name = role === 'outbox' ? 'ROS_OUTBOX_WORKER_ID' : 'ROS_CONTACT_WORKER_ID';
    resolved[name] = `${prefix}:${role}:${taskDigest}`;
  }
  return resolved;
}
