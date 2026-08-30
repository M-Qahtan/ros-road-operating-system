import { createServer, IncomingMessage } from 'node:http';
import { parsePort } from './config.js';
import { createRoadEventHttpHandler } from './http/road-event-http.js';
import { createRuntimeActorResolver } from './http/runtime-actor-resolver.js';
import { createHumanSafetyHttpHandler, PostgresHumanSafetyStore } from './http/human-safety-http.js';
import { createEvidenceHttpHandler } from './http/evidence-http.js';
import {
  createMobileMvpHttpHandler,
  DurableFieldCompanionStore,
  PostgresFieldCompanionDeviceRegistry,
  PostgresNotificationAudit
} from './http/mobile-mvp-http.js';
import { PostgresContactRuntimeRepository } from './ros-eye/contact-orchestration-postgres.js';
import { PostgresTransactionPool } from './persistence/postgres/postgres-transaction-pool.js';
import { createEvidenceServiceForRuntime } from './evidence/evidence-runtime.js';
import { createEvidenceObjectStorageForRuntime } from './evidence/object-storage-runtime.js';
import { createContactMvpRuntime } from './runtime/contact-mvp-runtime.js';
import { createOutboxWorkerRuntime } from './runtime/outbox-worker-runtime.js';
import { BackgroundWorkerSupervisor, type BackgroundWorker } from './runtime/background-worker-supervisor.js';
import {
  applyCorsHeaders,
  applySecurityHeaders,
  corsPreflightAllowed,
  createCorsPolicy,
  resolveTraceId
} from './request-security.js';
import { bootstrapRoadEventRuntime } from './runtime/runtime-bootstrap.js';
import { validateRuntimeEnvironment } from './runtime/operational-readiness.js';
import { structuredLog, withTraceBoundary } from './runtime/telemetry.js';

validateRuntimeEnvironment(process.env);
const port = parsePort(process.env.PORT);
const actorResolver = createRuntimeActorResolver(process.env);
const corsPolicy = createCorsPolicy(process.env);
const runtime = await bootstrapRoadEventRuntime(process.env);
const persistentSql = runtime.postgres === null ? null : new PostgresTransactionPool(runtime.postgres);
const deviceRegistry = persistentSql === null ? null : new PostgresFieldCompanionDeviceRegistry(persistentSql);
const handleRoadEvent = createRoadEventHttpHandler(runtime.application, actorResolver, deviceRegistry);
const contactRepository = persistentSql === null ? null : new PostgresContactRuntimeRepository(persistentSql);
const contactRuntime = contactRepository === null ? null : createContactMvpRuntime(contactRepository, process.env);
const roadEventOutboxRuntime = runtime.postgres === null || runtime.redis === null
  ? null
  : createOutboxWorkerRuntime(runtime.postgres, runtime.redis, process.env);
const handleHumanSafety = createHumanSafetyHttpHandler(
  runtime.application,
  persistentSql === null || contactRepository === null
    ? null
    : new PostgresHumanSafetyStore(persistentSql, contactRepository),
  runtime.idempotency,
  actorResolver
);
const handleMobileMvp = createMobileMvpHttpHandler(
  runtime.roadEvents,
  contactRepository === null ? null : new DurableFieldCompanionStore(contactRepository),
  persistentSql === null ? null : new PostgresNotificationAudit(persistentSql),
  runtime.idempotency,
  actorResolver,
  { contactOrchestration: contactRuntime?.service ?? null, devices: deviceRegistry }
);
const evidenceObjectStorage = runtime.postgres === null ? null : createEvidenceObjectStorageForRuntime(process.env);
const evidenceService = runtime.postgres === null || evidenceObjectStorage === null
  ? null
  : createEvidenceServiceForRuntime(process.env, {
      postgres: runtime.postgres,
      roadEvents: runtime.roadEvents,
      objectStorage: evidenceObjectStorage
    });
const handleEvidence = createEvidenceHttpHandler(evidenceService, runtime.idempotency, actorResolver);

// Refuse to advertise readiness until both durable worker paths can execute at
// least one cycle against the migrated dependencies.
try {
  if (roadEventOutboxRuntime !== null) await roadEventOutboxRuntime.runOnce();
  if (contactRuntime !== null) await contactRuntime.runOnce();
} catch (error) {
  await runtime.close();
  throw error;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new RangeError('Request body exceeds 1 MiB');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const workerSupervisor = new BackgroundWorkerSupervisor();

const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
  const traceId = resolveTraceId(request.headers['x-trace-id']);
  applySecurityHeaders(response);
  response.setHeader('x-trace-id', traceId);

  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  if (!applyCorsHeaders(response, origin, corsPolicy)) {
    response.writeHead(403);
    response.end(JSON.stringify({ success: false, data: null, error: { code: 'CORS_ORIGIN_DENIED', message: 'Request origin is not allowed' }, traceId }));
    return;
  }

  if (request.method === 'OPTIONS') {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const requestedMethod = typeof request.headers['access-control-request-method'] === 'string'
      ? request.headers['access-control-request-method'] : undefined;
    const requestedHeaders = typeof request.headers['access-control-request-headers'] === 'string'
      ? request.headers['access-control-request-headers'] : undefined;
    if (origin === undefined || !url.pathname.startsWith('/api/v1/') || !corsPreflightAllowed(requestedMethod, requestedHeaders)) {
      response.writeHead(403);
      response.end(JSON.stringify({ success: false, data: null, error: { code: 'CORS_PREFLIGHT_DENIED', message: 'CORS preflight is not allowed' }, traceId }));
      return;
    }
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === '/health' && request.method === 'GET') {
    response.writeHead(200);
    response.end(JSON.stringify({ status: 'alive', service: 'ros-api', traceId }));
    return;
  }

  if (request.url === '/ready' && request.method === 'GET') {
    const readiness = await runtime.readiness(evidenceObjectStorage === null ? {} : {
      objectStorage: () => evidenceObjectStorage.checkReadiness(AbortSignal.timeout(900))
    });
    const status = readiness.status === 'ready' && !workerSupervisor.failed ? 'ready' : 'not_ready';
    response.writeHead(status === 'ready' ? 200 : 503);
    response.end(JSON.stringify({
      ...readiness,
      status,
      workers: {
        roadEventOutbox: roadEventOutboxRuntime === null ? 'not_required' : workerSupervisor.failed ? 'failed' : 'running',
        humanContact: contactRuntime === null ? 'not_required' : workerSupervisor.failed ? 'failed' : 'running'
      },
      service: 'ros-api',
      traceId
    }));
    return;
  }

  try {
    await withTraceBoundary('http.api', traceId, async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const query: Record<string, string | undefined> = {};
      for (const [key, value] of url.searchParams.entries()) query[key] = value;
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[key] = value;
      }
      const httpRequest = {
        method: request.method ?? 'GET',
        path: url.pathname,
        query,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? null : await readJsonBody(request),
        traceId
      };
      const result = await handleHumanSafety(httpRequest)
        ?? await handleMobileMvp(httpRequest)
        ?? await handleEvidence(httpRequest)
        ?? await handleRoadEvent(httpRequest);
      response.writeHead(result.status);
      response.end(JSON.stringify(result.body));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    response.writeHead(400);
    response.end(JSON.stringify({ success: false, data: null, error: { code: 'INVALID_REQUEST', message }, traceId }));
  }
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

let shuttingDown = false;
async function shutdown(signal: 'SIGTERM' | 'SIGINT' | 'WORKER_FAILURE'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(structuredLog('info', 'ROS API shutdown requested', { operation: signal }));
  await new Promise<void>((resolve) => { server.close(() => resolve()); });
  try {
    await workerSupervisor.stop(signal);
    await runtime.close();
  } catch {
    process.exitCode = 1;
    console.error(structuredLog('error', 'ROS runtime resource shutdown failed', { operation: 'runtime.close' }));
  }
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

server.listen(port, () => {
  console.log(structuredLog('info', 'ROS API listening', { operation: `listen:${port}`, runtimeMode: runtime.mode }));
  const workers: BackgroundWorker[] = [];
  if (roadEventOutboxRuntime !== null) workers.push((signal) => roadEventOutboxRuntime.run(signal));
  if (contactRuntime !== null) workers.push((signal) => contactRuntime.run(signal));
  workerSupervisor.start(workers, () => {
    process.exitCode = 1;
    console.error(structuredLog('error', 'ROS required background worker failed', { operation: 'worker.run' }));
    void shutdown('WORKER_FAILURE');
  });
});
