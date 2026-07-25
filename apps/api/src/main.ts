import { createServer } from 'node:http';
import { parsePort } from './config.js';
import { applySecurityHeaders, resolveTraceId } from './request-security.js';

const port = parsePort(process.env.PORT);

const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
  const traceId = resolveTraceId(request.headers['x-trace-id']);
  applySecurityHeaders(response);
  response.setHeader('x-trace-id', traceId);

  if (request.url === '/health' && request.method === 'GET') {
    response.writeHead(200);
    response.end(JSON.stringify({ status: 'ok', service: 'ros-api', traceId }));
    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND' }, traceId }));
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

server.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', message: 'ROS API listening', port }));
});
