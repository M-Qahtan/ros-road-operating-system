import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)), '..');
const port = Number(process.env.MOBILE_PORT ?? 4174);
const mime: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

createServer((request, response) => {
  const pathname = request.url === '/' ? '/public/index.html' : request.url ?? '/public/index.html';
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = join(root, safePath);
  if (!candidate.startsWith(root) || !existsSync(candidate)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': mime[extname(candidate)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'",
    'permissions-policy': 'geolocation=(), camera=(), microphone=()'
  });
  createReadStream(candidate).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ level: 'info', message: 'ROS Eye field companion listening', port, simulation: true }));
});
