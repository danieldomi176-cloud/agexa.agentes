/** LOCAL integration fixture: Chromium→BFF→verified TLS→real Office. No Base44 login/deploy. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { build } from 'esbuild';
import { chromium } from 'playwright';

import { SalesEngine } from '../server/src/agexa/engine.ts';
import { createOfficeGateway } from '../integrations/base44/officeGatewayHandler.ts';
const hosted = process.argv.includes('--hosted');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-ceo-tls-test-'));
const data = path.join(root, 'data');
fs.mkdirSync(data, { mode: 0o700 });
if (hosted) {
  const fixture = new SalesEngine(data);
  fixture.close();
}
const secret = 'TEST-ONLY-NOT-A-REAL-DEPLOYMENT-SECRET-' + randomUUID();
const keyFile = path.join(root, 'bridge-secret');
fs.writeFileSync(keyFile, secret, { mode: 0o600 });
let office,
  edge,
  bff,
  browser,
  log = '';
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function close(server) {
  if (server?.listening) {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 32768) throw Error('Oversized fixture request');
  }
  return raw;
}
try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      path.join(root, 'tls.key'),
      '-out',
      path.join(root, 'tls.crt'),
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  fs.chmodSync(path.join(root, 'tls.key'), 0o600);
  const cert = fs.readFileSync(path.join(root, 'tls.crt'));
  const probe = net.createServer(),
    officePort = await listen(probe);
  await close(probe);
  edge = https.createServer(
    { key: fs.readFileSync(path.join(root, 'tls.key')), cert },
    (req, res) => {
      if (req.url !== '/api/ceo/v1/request' || req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      const upstream = http.request(
        {
          hostname: '127.0.0.1',
          port: officePort,
          path: req.url,
          method: 'POST',
          headers: { ...req.headers, 'x-forwarded-proto': 'https' },
        },
        (reply) => {
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  const edgePort = await listen(edge),
    officeOrigin = `https://127.0.0.1:${edgePort}`;
  function spawnOffice() {
    const child = spawn(
      process.execPath,
      [
        ...(hosted
          ? ['dist/hosted.js']
          : [
              'dist/cli.js',
              '--agexa',
              '--host',
              '127.0.0.1',
              '--port',
              String(officePort),
              '--no-terminal',
            ]),
      ],
      {
        env: {
          ...process.env,
          AGEXA_DATA_DIR: data,
          PORT: String(officePort),
          AGEXA_TLS_TERMINATION: 'trusted-proxy',
          AGEXA_HOSTED_PROXY_IP: '127.0.0.1',
          AGEXA_PERSISTENT_ROOT: root,
          AGEXA_PERSISTENCE_CONFIRMED: '1',
          AGEXA_CEO_BRIDGE_ENABLED: '1',
          AGEXA_OFFICE_PUBLIC_ORIGIN: officeOrigin,
          AGEXA_CEO_READ_IDS: '',
          AGEXA_CEO_CONTROL_IDS: 'fixture-ceo',
          AGEXA_CEO_TRUSTED_PROXY_IP: '127.0.0.1',
          AGEXA_CEO_BRIDGE_SECRET: '',
          AGEXA_CEO_BRIDGE_SECRET_FILE: keyFile,
          AGEXA_INFERENCE_TEST_MODE: '0',
          AGEXA_MESSAGING_TEST_MODE: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.on('data', (chunk) => {
      log += chunk;
    });
    child.stderr.on('data', (chunk) => {
      log += chunk;
    });
    return child;
  }
  office = spawnOffice();
  let ready = false;
  for (let n = 0; n < 200; n++) {
    try {
      ready = (await fetch(`http://127.0.0.1:${officePort}${hosted ? '/healthz' : '/api/health'}`))
        .ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, 'Office fixture startup failed');
  // Trust only this fixture CA; keep certificate/hostname verification enabled.
  function tlsFetch(ca) {
    return (url, options = {}) =>
      new Promise((resolve, reject) => {
        const request = https.request(
          url,
          { method: options.method, headers: options.headers, ca, signal: options.signal },
          (response) => {
            const chunks = [];
            let length = 0;
            response.on('data', (chunk) => {
              length += chunk.length;
              if (length > 1048576) request.destroy(Error('Oversized response'));
              else chunks.push(chunk);
            });
            response.on('end', () =>
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: response.statusCode,
                  headers: response.headers,
                }),
              ),
            );
          },
        );
        request.on('error', reject);
        request.end(options.body);
      });
  }
  const session = randomUUID();
  let gateway;
  const bundle = await build({
    entryPoints: ['integrations/base44/officeClient.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
  });
  bff = http.createServer(async (req, res) => {
    try {
      if (req.url === '/client.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(bundle.outputFiles[0].text);
        return;
      }
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          `<title>AGEXA LOCAL CEO API TEST</title><p>ISOLATED TEST — Base44 session fixture; real local Office backend</p><div id="employees"></div><script type="module">import {createOfficeClient} from '/client.js'; window.office=createOfficeClient(async(name,payload)=>{const r=await fetch('/bff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {data:await r.json()};});window.render=async()=>{const state=await window.office.read('office.state');document.querySelector('#employees').textContent=state.employees.map(e=>e.name+': '+e.status).join(' | ');return state;};await window.render();</script>`,
        );
        return;
      }
      if (req.url !== '/bff') {
        res.writeHead(404);
        res.end();
        return;
      }
      const incoming = new Request('http://fixture/bff', {
        method: 'POST',
        body: await body(req),
        headers: req.headers,
      });
      const response = await gateway(incoming);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(500);
      res.end('Fixture failure');
    }
  });
  const bffPort = await listen(bff),
    frontend = `http://127.0.0.1:${bffPort}`;
  const deps = {
    officeOrigin,
    frontendOrigin: frontend,
    secret,
    actors: new Map([['fixture-ceo', 'control']]),
    authenticate: async (req) =>
      req.headers.get('cookie') === `ceo_fixture=${session}` ? { id: 'fixture-ceo' } : null,
    fetcher: tlsFetch(cert),
  };
  gateway = createOfficeGateway(deps);
  const request = { operation: 'office.state', requestId: randomUUID(), input: {} };
  const unauthorized = await fetch(frontend + '/bff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  assert.equal(unauthorized.status, 401);
  const badTLS = createOfficeGateway({ ...deps, fetcher: tlsFetch(undefined) });
  assert.equal(
    (
      await badTLS(
        new Request(frontend + '/bff', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `ceo_fixture=${session}` },
          body: JSON.stringify(request),
        }),
      )
    ).status,
    502,
  );
  browser = await chromium.launch(
    process.env.AGEXA_CHROMIUM_PATH
      ? { executablePath: process.env.AGEXA_CHROMIUM_PATH, args: ['--no-sandbox'] }
      : {},
  );
  const context = await browser.newContext();
  await context.addCookies([
    { name: 'ceo_fixture', value: session, url: frontend, httpOnly: true, sameSite: 'Strict' },
  ]);
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.postData() ?? ''));
  await page.goto(frontend);
  await page.waitForFunction(() =>
    document.querySelector('#employees').textContent.includes('ORION'),
  );
  assert.equal(await page.evaluate(() => document.cookie), '');
  const state = await page.evaluate(() => window.render());
  assert.equal(state.employees.length, 8);
  await page.evaluate(async () => {
    await window.office.request({
      operation: 'operations.stop',
      requestId: crypto.randomUUID(),
      input: {},
      confirm: true,
    });
  });
  assert.equal((await page.evaluate(() => window.render())).suspended, true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok((await page.locator('#employees').textContent()).includes('NEXUS'));
  const token = fs.readFileSync(path.join(data, 'standalone-token'), 'utf8').trim();
  assert.ok(!requests.join('').includes(token));
  assert.ok(!requests.join('').includes(secret));
  assert.ok(!log.includes(token));
  assert.ok(!log.includes(secret));
  assert.ok(log.includes(hosted ? 'hosted edge ready' : 'bootstrap URL suppressed'));
  if (hosted) {
    for (const url of [
      '/api/health',
      '/api/agexa/state',
      '/terminal/1',
      '/ws',
      '/hooks',
      '/sales.sqlite',
      '/api/ceo/v1/request?token=bad',
    ]) {
      const denied = await fetch(`http://127.0.0.1:${officePort}` + url, {
        headers: { authorization: 'Bearer ' + token },
      });
      assert.equal(denied.status, 404);
    }
    assert.ok(fs.readdirSync(path.join(data, 'backups')).some((file) => file.endsWith('.sqlite')));
    office.kill('SIGTERM');
    await once(office, 'exit');
    office = spawnOffice();
    let restored = false;
    for (let n = 0; n < 400; n++) {
      try {
        restored = (await fetch(`http://127.0.0.1:${officePort}/healthz`)).ok;
      } catch {}
      if (restored) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(restored, 'Hosted restart failed');
    const restarted = await page.evaluate(() => window.render());
    assert.equal(restarted.suspended, true);
    assert.equal(restarted.employees.length, 8);
    assert.equal(fs.readFileSync(path.join(data, 'standalone-token'), 'utf8').trim(), token);
    assert.ok(
      fs.readdirSync(path.join(data, 'backups')).filter((file) => file.endsWith('.sqlite'))
        .length >= 2,
    );
    for (const file of fs
      .readdirSync(path.join(data, 'backups'))
      .filter((file) => file.endsWith('.sqlite'))) {
      const full = path.join(data, 'backups', file);
      assert.equal(fs.statSync(full).mode & 0o777, 0o600);
      const copy = new DatabaseSync(full, { readOnly: true });
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      copy.close();
    }
    console.log(
      'PASS HOSTED: PORT edge, blocked private routes, restored fixture database, verified backups and state/token preserved after restart. Not a Render deploy.',
    );
  }
  console.log(
    'PASS: LOCAL Chromium session fixture → BFF → verified TLS → real eight employees and stop operation; wrong CA/login denied; no browser permanent token/key or credential logs. Base44 deployment/login and public TLS NOT validated.',
  );
} finally {
  if (browser) await browser.close();
  await close(bff);
  await close(edge);
  if (office && office.exitCode === null) {
    office.kill('SIGTERM');
    await once(office, 'exit');
  }
  fs.rmSync(root, { recursive: true, force: true });
}
