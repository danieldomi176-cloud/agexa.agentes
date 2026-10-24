/** Production edge around the ORIGINAL standalone backend. No second agent engine. */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';

import { ceoConfig } from './agexa/ceo/config.js';

const API = '/api/ceo/v1/request';
export interface HostedConfig {
  port: number;
  origin: string;
  data: string;
  root: string;
  tlsMode: 'render' | 'trusted-proxy';
  proxyIp: string;
}
export function hostedConfig(
  env = process.env,
  mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8'),
): HostedConfig {
  const port = Number(env.PORT);
  const origin = new URL(env.AGEXA_OFFICE_PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || '');
  const tlsMode = env.AGEXA_TLS_TERMINATION;
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !['render', 'trusted-proxy'].includes(tlsMode ?? '') ||
    env.AGEXA_CEO_BRIDGE_ENABLED !== '1'
  )
    throw Error('PORT, HTTPS origin and enabled CEO bridge are required');
  if (
    tlsMode === 'render' &&
    (env.RENDER !== 'true' || !env.RENDER_EXTERNAL_URL?.startsWith('https://'))
  )
    throw Error('Render TLS mode requires the Render platform');
  if (env.RENDER === 'true' && tlsMode !== 'render')
    throw Error('Render requires strict persistent-disk mode');
  const root = env.AGEXA_PERSISTENT_ROOT ?? '',
    data = env.AGEXA_DATA_DIR ?? '';
  if (
    !path.isAbsolute(root) ||
    root === '/' ||
    !path.isAbsolute(data) ||
    data === root ||
    !data.startsWith(root + path.sep) ||
    !fs.existsSync(root) ||
    fs.realpathSync(root) !== root ||
    (fs.existsSync(data) && fs.realpathSync(data) !== data)
  )
    throw Error('Private persistent data directory required');
  const mounted = mounts
    .split('\n')
    .some(
      (line) =>
        line.split(' ')[4] === root &&
        !!line.split(' - ')[1] &&
        !['tmpfs', 'ramfs', 'overlay'].includes(line.split(' - ')[1].split(' ')[0]),
    );
  if (!mounted && (tlsMode === 'render' || env.AGEXA_PERSISTENCE_CONFIRMED !== '1'))
    throw Error('Persistent mount not detected; refusing an ephemeral database');
  const proxyIp = env.AGEXA_HOSTED_PROXY_IP ?? '127.0.0.1';
  if (tlsMode === 'trusted-proxy' && !net.isIP(proxyIp))
    throw Error('Exact trusted proxy IP required');
  return {
    port,
    origin: origin.origin,
    data,
    root,
    tlsMode: tlsMode as HostedConfig['tlsMode'],
    proxyIp,
  };
}
async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 32768) throw Error('Request too large');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
export function hostedEdge(
  config: HostedConfig,
  privatePort: number,
  healthy: () => boolean,
  maintenance = false,
): http.Server {
  let window = 0,
    attempts = 0;
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/healthz' && req.method === 'GET')
      return reply(
        maintenance || healthy() ? 200 : 503,
        maintenance ? { ready: false, maintenance: true } : { ready: healthy() },
      );
    const now = Math.floor(Date.now() / 60000);
    if (now !== window) {
      window = now;
      attempts = 0;
    }
    if (++attempts > 300) return reply(429, { error: 'Request limit' });
    if (req.url !== API || req.method !== 'POST') return reply(404, { error: 'Not found' });
    if (
      req.headers.origin !== undefined ||
      req.headers.host !== new URL(config.origin).host ||
      req.headers['x-forwarded-proto'] !== 'https' ||
      (config.tlsMode === 'trusted-proxy' && req.socket.remoteAddress !== config.proxyIp)
    )
      return reply(403, { error: 'Transport denied' });
    if (!healthy()) return reply(503, { error: 'Backend unavailable' });
    if (Number(req.headers['content-length'] ?? 0) > 32768)
      return reply(413, { error: 'Request too large' });
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      return reply(413, { error: 'Invalid or oversized body' });
    }
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: privatePort,
        path: API,
        method: 'POST',
        headers: {
          host: new URL(config.origin).host,
          'content-type': req.headers['content-type'] ?? 'application/json',
          'x-forwarded-proto': 'https',
          'x-agexa-timestamp': req.headers['x-agexa-timestamp'] ?? '',
          'x-agexa-nonce': req.headers['x-agexa-nonce'] ?? '',
          'x-agexa-signature': req.headers['x-agexa-signature'] ?? '',
        },
      },
      (response) => {
        const parts: Buffer[] = [];
        let size = 0;
        response.on('data', (part) => {
          size += part.length;
          if (size > 1048576) upstream.destroy(Error('Oversized response'));
          else parts.push(part);
        });
        response.on('end', () => {
          if (res.writableEnded) return;
          const headers: http.OutgoingHttpHeaders = {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, private',
          };
          for (const name of ['x-agexa-timestamp', 'x-agexa-nonce', 'x-agexa-signature'])
            if (response.headers[name]) headers[name] = response.headers[name];
          res.writeHead(response.statusCode ?? 502, headers);
          res.end(Buffer.concat(parts));
        });
      },
    );
    upstream.setTimeout(12000, () => upstream.destroy(Error('Timeout')));
    upstream.on('error', () => {
      if (!res.writableEnded)
        reply(502, { error: 'Private backend unavailable; review command before retry' });
    });
    upstream.end(body);
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.maxConnections = 128;
  server.on('upgrade', (_req, socket) =>
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'),
  );
  return server;
}
async function main(): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw Error('Node 22 required');
  const cfg = hostedConfig();
  if (
    !fs.existsSync(path.dirname(cfg.data)) ||
    fs.realpathSync(path.dirname(cfg.data)) !== path.dirname(cfg.data)
  )
    throw Error('Persistent data parent must be a real directory');
  fs.mkdirSync(cfg.data, { recursive: true, mode: 0o700 });
  fs.chmodSync(cfg.data, 0o700);
  if (process.env.AGEXA_MAINTENANCE === '1') {
    const maintenance = hostedEdge(cfg, 0, () => false, true);
    maintenance.listen(cfg.port, '0.0.0.0');
    for (const signal of ['SIGTERM', 'SIGINT'] as const)
      process.once(signal, () => {
        maintenance.close();
        maintenance.closeIdleConnections();
      });
    console.log(
      'AGEXA maintenance only: API unavailable; restore private data before enabling operations.',
    );
    return;
  }
  if (!fs.existsSync(path.join(cfg.data, 'sales.sqlite')))
    throw Error('Restore the existing database before starting hosted operations');
  const bridge = ceoConfig({
    ...process.env,
    AGEXA_OFFICE_PUBLIC_ORIGIN: cfg.origin,
    AGEXA_CEO_TRUSTED_PROXY_IP: '127.0.0.1',
  });
  if (!bridge || bridge.secret().length < 32) throw Error('CEO bridge key and identities required');
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => probe.once('listening', resolve));
  const privatePort = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const child = spawn(
    process.execPath,
    [
      path.join(__dirname, 'cli.js'),
      '--agexa',
      '--host',
      '127.0.0.1',
      '--port',
      String(privatePort),
      '--no-terminal',
    ],
    {
      env: {
        ...process.env,
        AGEXA_DATA_DIR: cfg.data,
        AGEXA_OFFICE_PUBLIC_ORIGIN: cfg.origin,
        AGEXA_CEO_TRUSTED_PROXY_IP: '127.0.0.1',
        AGEXA_INFERENCE_TEST_MODE: '0',
        AGEXA_MESSAGING_TEST_MODE: '0',
      },
      stdio: 'ignore',
    },
  );
  let ready = false,
    stopping = false,
    timer: ReturnType<typeof setInterval> | undefined;
  const server = hostedEdge(cfg, privatePort, () => ready && child.exitCode === null);
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    ready = false;
    if (timer) clearInterval(timer);
    server.close();
    server.closeIdleConnections();
    child.kill('SIGTERM');
    const force = setTimeout(() => {
      child.kill('SIGKILL');
      server.closeAllConnections();
    }, 25000);
    force.unref();
    process.exitCode = code;
  };
  child.once('error', () => stop(1));
  child.once('exit', () => {
    if (!stopping) {
      console.error('Private backend exited');
      stop(1);
    }
  });
  process.once('SIGTERM', () => stop(0));
  process.once('SIGINT', () => stop(0));
  try {
    let online = false;
    for (let attempt = 0; attempt < 400; attempt++) {
      if (child.exitCode !== null) throw Error('Private backend startup failed');
      try {
        online = (await fetch(`http://127.0.0.1:${privatePort}/api/health`)).ok;
      } catch {}
      if (online) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!online) throw Error('Private startup timeout');
    const backup = async () => {
      const token = fs.readFileSync(path.join(cfg.data, 'standalone-token'), 'utf8').trim();
      const response = await fetch(`http://127.0.0.1:${privatePort}/api/agexa/readiness/backup`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error('Backup failed');
      const proof = (await response.json()) as { integrity?: string };
      if (proof.integrity !== 'ok') throw Error('Backup integrity failed');
      console.log('Private SQLite backup verified');
    };
    await backup();
    ready = true;
    timer = setInterval(
      () =>
        void backup().catch(() => {
          ready = false;
          console.error('Private backup failed; publication health disabled');
        }),
      6 * 3600000,
    );
    timer.unref();
    server.listen(cfg.port, '0.0.0.0');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    console.log('AGEXA hosted edge ready on PORT; private backend and verified backups active.');
  } catch {
    stop(1);
    console.error(
      'Hosted startup failed; verify deployment configuration, persistent disk and private backend.',
    );
  }
}
if (require.main === module)
  void main().catch(() => {
    console.error('Invalid hosted configuration; no public server started.');
    process.exitCode = 1;
  });
