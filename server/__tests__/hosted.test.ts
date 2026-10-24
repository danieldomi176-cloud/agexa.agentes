import { once } from 'node:events';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { hostedConfig, hostedEdge } from '../src/hosted.js';

let root: string;
const servers: http.Server[] = [];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-hosted-config-'));
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  fs.rmSync(root, { recursive: true, force: true });
});
function env(): NodeJS.ProcessEnv {
  return {
    PORT: '10000',
    AGEXA_CEO_BRIDGE_ENABLED: '1',
    AGEXA_OFFICE_PUBLIC_ORIGIN: 'https://office.example.org',
    AGEXA_TLS_TERMINATION: 'trusted-proxy',
    AGEXA_HOSTED_PROXY_IP: '127.0.0.1',
    AGEXA_PERSISTENT_ROOT: root,
    AGEXA_DATA_DIR: path.join(root, 'data'),
    AGEXA_PERSISTENCE_CONFIRMED: '1',
  };
}
it('takes PORT and an explicitly confirmed self-hosted data directory without creating a database', () => {
  expect(hostedConfig(env(), '').port).toBe(10000);
  expect(fs.readdirSync(root)).toEqual([]);
});
it.each(['', '0', '-1', '65536', 'abc'])('rejects invalid PORT %s', (port) => {
  expect(() => hostedConfig({ ...env(), PORT: port }, '')).toThrow();
});
it('rejects insecure origin, ephemeral/unconfirmed paths and symlinks', () => {
  expect(() =>
    hostedConfig({ ...env(), AGEXA_OFFICE_PUBLIC_ORIGIN: 'http://office.example.org' }, ''),
  ).toThrow();
  expect(() => hostedConfig({ ...env(), AGEXA_PERSISTENCE_CONFIRMED: '' }, '')).toThrow();
  expect(() => hostedConfig({ ...env(), AGEXA_DATA_DIR: '/tmp/outside' }, '')).toThrow();
  fs.symlinkSync(os.tmpdir(), path.join(root, 'data'));
  expect(() => hostedConfig(env(), '')).toThrow();
});
it('requires Render platform metadata and a real non-ephemeral mount even when confirmation is set', () => {
  const render = {
    ...env(),
    AGEXA_TLS_TERMINATION: 'render',
    RENDER: 'true',
    RENDER_EXTERNAL_URL: 'https://office.example.org',
  };
  expect(() => hostedConfig(render, '')).toThrow();
  expect(() => hostedConfig(render, `1 0 0:0 / ${root} rw - tmpfs tmpfs rw`)).toThrow();
  expect(hostedConfig(render, `1 0 8:1 / ${root} rw - ext4 /dev/fixture rw`).data).toBe(
    path.join(root, 'data'),
  );
  expect(() => hostedConfig({ ...render, RENDER: '' }, '')).toThrow();
  expect(() => hostedConfig({ ...render, AGEXA_TLS_TERMINATION: 'trusted-proxy' }, '')).toThrow();
});
async function listen(server: http.Server): Promise<number> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}
it('offers maintenance health without exposing agent operations while restoring the existing database', async () => {
  const config = hostedConfig(env(), '');
  const edge = hostedEdge(config, 0, () => false, true);
  const port = await listen(edge);
  config.origin = `https://127.0.0.1:${port}`;
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ ready: false, maintenance: true });
  expect(
    (
      await fetch(`http://127.0.0.1:${port}/api/ceo/v1/request`, {
        method: 'POST',
        headers: { 'x-forwarded-proto': 'https' },
        body: '{}',
      })
    ).status,
  ).toBe(503);
});
it('exposes only health and the closed bridge; never forwards admin, shell, files or query-token routes', async () => {
  let forwarded = 0;
  const internal = http.createServer((_req, res) => {
    forwarded++;
    res.end('{}');
  });
  const cfg = hostedConfig(env(), '');
  let ready = true;
  const edge = hostedEdge(cfg, await listen(internal), () => ready);
  const port = await listen(edge);
  const base = `http://127.0.0.1:${port}`;
  for (const route of [
    '/',
    '/api/agexa/state',
    '/api/health',
    '/terminal/1',
    '/ws',
    '/hooks',
    '/sales.sqlite',
    '/api/ceo/v1/request?token=bad',
  ])
    expect((await fetch(base + route)).status).toBe(404);
  const health = await fetch(base + '/healthz');
  expect(await health.json()).toEqual({ ready: true });
  ready = false;
  expect((await fetch(base + '/healthz')).status).toBe(503);
  expect(forwarded).toBe(0);
});
it('validates transport and relays exact signed bytes with only safe response headers', async () => {
  let received = '';
  const internal = http.createServer(async (req, res) => {
    for await (const part of req) received += part;
    res.setHeader('X-Agexa-Nonce', 'fixture');
    res.setHeader('Set-Cookie', 'not-for-browser');
    res.end('{}');
  });
  const config = hostedConfig(env(), '');
  const edge = hostedEdge(config, await listen(internal), () => true);
  const port = await listen(edge);
  config.origin = `https://127.0.0.1:${port}`;
  const url = `http://127.0.0.1:${port}/api/ceo/v1/request`;
  expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(403);
  const headers = {
    'x-forwarded-proto': 'https',
    'content-type': 'application/json',
  };
  expect(
    (
      await fetch(url, {
        method: 'POST',
        headers: { ...headers, origin: 'https://evil.example' },
        body: '{}',
      })
    ).status,
  ).toBe(403);
  const result = await fetch(url, { method: 'POST', headers, body: '{"unchanged":"é"}' });
  expect(result.status).toBe(200);
  expect(received).toBe('{"unchanged":"é"}');
  expect(result.headers.has('set-cookie')).toBe(false);
  expect((await fetch(url, { method: 'POST', headers, body: 'x'.repeat(32769) })).status).toBe(413);
});
