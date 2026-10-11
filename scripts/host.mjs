// One public demo service: production assets and a same-origin, credential-free API.
import { createServer, request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../ghostgrid-backend/dist/app.js';
import { loadConfig } from '../ghostgrid-backend/dist/config.js';
import { MockAdapter } from '../ghostgrid-backend/dist/providers/mock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'ghostgrid-frontend/frontend/dist');
const token = randomBytes(32).toString('hex');
const config = loadConfig({ ...process.env, HOST: '127.0.0.1', PORT: '3002',
  GHOSTGRID_API_TOKEN: token, GHOSTGRID_ALLOWED_WORKSPACES: '',
  GHOSTGRID_DATA_DIR: process.env.GHOSTGRID_DATA_DIR ?? '/tmp/slop-angeles' });
// This public demo cannot run paid providers or open desktop processes.
const { app } = await buildApp({ config, registry: {
  get(provider) {
    if (provider.type !== 'mock') throw new Error('Use the local app to connect a provider.');
    return new MockAdapter();
  },
}, officeLauncher: {
  available: () => ({ runtimes: [], terminal: null }),
  launch: async () => { throw Object.assign(new Error('Desktop workers run in the local app.'), { statusCode: 409 }); },
} });
await app.listen({ host: config.host, port: config.port });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const error = (res, status, message) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: { message } })); };
const server = createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health' || url.pathname.startsWith('/gg/')) {
      const path = url.pathname === '/health' ? '/health' : url.pathname.slice(3);
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return error(res, 403, 'Origin is not allowed.');
      if (!/^\/(?:health$|api\/v1\/(?:status|openapi\.json|provider-credits|usage|metrics|providers|projects|agents|sessions|tasks|events|artifacts|office\/(?:options|workers))(?:\/|$))/.test(path) || path.includes('/library')) return error(res, 404, 'This feature runs in the local app.');
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) return error(res, 413, 'Request too large.');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (path.startsWith('/api/v1/office/')) return error(res, 409, 'Desktop workers run in the local app.');
        let json;
        try { json = body.length ? JSON.parse(body.toString()) : {}; } catch { return error(res, 400, 'Invalid JSON.'); }
        if (json.workspace || json.apiKeyEnv || json.baseUrl || json.headersEnv || (json.type && json.type !== 'mock')) return error(res, 403, 'Connected providers and workspaces run in the local app.');
      }
      const headers = { ...req.headers, host: `127.0.0.1:${config.port}`, authorization: `Bearer ${token}` };
      for (const key of ['origin', 'referer', 'cookie', 'connection', 'transfer-encoding']) delete headers[key];
      headers['content-length'] = String(body.length);
      const upstream = request({ hostname: '127.0.0.1', port: config.port, path: path + url.search, method: req.method, headers }, response => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) error(res, 502, 'API is restarting.'); else res.destroy(); });
      res.on('close', () => upstream.destroy());
      upstream.end(body);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return error(res, 405, 'Method not allowed.');
    let path = resolve(assets, '.' + decodeURIComponent(url.pathname));
    if (path !== assets && !path.startsWith(assets + sep)) return error(res, 404, 'Not found.');
    let info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      if (url.pathname.startsWith('/assets/') || extname(url.pathname)) return error(res, 404, 'Not found.');
      path = resolve(assets, 'index.html'); info = await stat(path);
    }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Content-Length': info.size,
      'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    if (req.method === 'HEAD') res.end(); else createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) error(res, 400, 'Invalid request.'); else res.destroy(); }
});
server.listen(Number(process.env.PORT ?? 10000), '0.0.0.0', () => console.log('Ghost Grid web service ready.'));
async function close() { server.closeAllConnections(); await new Promise(r => server.close(r)); await app.close(); process.exit(0); }
process.once('SIGTERM', close); process.once('SIGINT', close);
