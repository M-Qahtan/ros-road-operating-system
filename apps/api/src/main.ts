import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT ?? 3000);

const server = createServer((request, response) => {
  const traceId = request.headers['x-trace-id']?.toString() ?? randomUUID();
  response.setHeader('content-type', 'application/json');
  response.setHeader('x-trace-id', traceId);

  if (request.url === '/health' && request.method === 'GET') {
    response.writeHead(200);
    response.end(JSON.stringify({ status: 'ok', service: 'ros-api', traceId }));
    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND' }, traceId }));
});

server.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', message: 'ROS API listening', port }));
});
