import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMobileSecurityHeaders } from './server-security.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)), '..');
const port = Number(process.env.MOBILE_PORT ?? 4174);
const apiOrigin = publicApiOrigin(process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:3000');
const securityHeaders = buildMobileSecurityHeaders(apiOrigin);
const mime: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

createServer(async (request, response) => {
  const pathname = request.url === '/' ? '/public/index.html' : request.url ?? '/public/index.html';
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = join(root, safePath);
  if (!candidate.startsWith(root) || !existsSync(candidate)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...securityHeaders });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': mime[extname(candidate)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    ...securityHeaders
  });
  if (extname(candidate) === '.html') {
    const html = await readFile(candidate, 'utf8');
    response.end(html.replace('data-api-base=""', `data-api-base="${apiOrigin}"`));
    return;
  }
  createReadStream(candidate).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ level: 'info', message: 'ROS Eye field companion listening', port, apiOrigin, simulation: false }));
});

function publicApiOrigin(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('API_PUBLIC_ORIGIN must be a valid URL origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API_PUBLIC_ORIGIN must be a credential-free HTTP(S) origin');
  }
  if ((process.env.NODE_ENV ?? 'development') === 'production' && url.protocol !== 'https:') {
    throw new Error('Production API_PUBLIC_ORIGIN must use HTTPS');
  }
  return url.origin;
}
