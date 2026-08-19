import { createServer, IncomingMessage } from 'node:http';
import { RoadEventApplicationService } from './application/road-event-application.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from './application/local-adapters.js';
import { parsePort } from './config.js';
import { createRoadEventHttpHandler } from './http/road-event-http.js';
import { createRuntimeActorResolver } from './http/runtime-actor-resolver.js';
import { applySecurityHeaders, resolveTraceId } from './request-security.js';
import { evaluateReadiness, validateRuntimeEnvironment } from './runtime/operational-readiness.js';
import { structuredLog, withTraceBoundary } from './runtime/telemetry.js';

validateRuntimeEnvironment(process.env);
const port = parsePort(process.env.PORT);
const repository = new MemoryRoadEventRepository();
const application = new RoadEventApplicationService(
  repository,
  new RoleMatrixAuthorizationAdapter(),
  new MemoryIdempotencyAdapter(),
  new MemorySignalAttachmentAdapter(),
  repository
);
const handleRoadEvent = createRoadEventHttpHandler(
  application,
  createRuntimeActorResolver(process.env)
);

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

const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
  const traceId = resolveTraceId(request.headers['x-trace-id']);
  applySecurityHeaders(response);
  response.setHeader('x-trace-id', traceId);

  if (request.url === '/health' && request.method === 'GET') {
    response.writeHead(200);
    response.end(JSON.stringify({ status: 'alive', service: 'ros-api', traceId }));
    return;
  }

  if (request.url === '/ready' && request.method === 'GET') {
    const readiness = await evaluateReadiness(process.env);
    response.writeHead(readiness.status === 'ready' ? 200 : 503);
    response.end(JSON.stringify({ ...readiness, service: 'ros-api', traceId }));
    return;
  }

  try {
    await withTraceBoundary('http.road_event', traceId, async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const query: Record<string, string | undefined> = {};
      for (const [key, value] of url.searchParams.entries()) query[key] = value;
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[key] = value;
      }
      const result = await handleRoadEvent({
        method: request.method ?? 'GET',
        path: url.pathname,
        query,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? null : await readJsonBody(request),
        traceId
      });
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

server.listen(port, () => {
  console.log(structuredLog('info', 'ROS API listening', {
    operation: `listen:${port}`
  }));
});
