/** Real Office services/SQLite/HTTP; Base44 login and HTTPS edge are injected fixtures. */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { CeoBridgeRequest, CeoBrowserRequest } from '../../core/src/ceoBridge.js';
import { CEO_OPERATIONS } from '../../core/src/ceoBridge.js';
import { createOfficeGateway } from '../../integrations/base44/officeGatewayHandler.js';
import { CEO_PATH, ceoSignature, ceoVerify } from '../../integrations/base44/officeProtocol.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import type { CeoConfig } from '../src/agexa/ceo/config.js';
import { ceoConfig } from '../src/agexa/ceo/config.js';
import { CeoStore } from '../src/agexa/ceo/store.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { createHttpServer } from '../src/httpServer.js';

const SECRET = 'TEST-ONLY-CEO-BRIDGE-KEY-NOT-A-REAL-CREDENTIAL';
const ADMIN = 'TEST-ONLY-legacy-office-administrator';
const actors = new Map<string, 'read' | 'control'>([
  ['fixture-ceo', 'control'],
  ['fixture-reader', 'read'],
]);
const config: CeoConfig = {
  publicOrigin: 'https://office.example.org',
  trustedProxyIp: '127.0.0.1',
  actors,
  secret: () => SECRET,
};
let root: string, engine: SalesEngine, app: FastifyInstance;
async function start(cfg: CeoConfig | null = config) {
  engine = new SalesEngine(root);
  app = (
    await createHttpServer({
      embedded: true,
      token: ADMIN,
      store: new AgentStateStore(),
      salesEngine: engine,
      ceoBridge: cfg,
    })
  ).app;
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-ceo-api-'));
  await start();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function envelope(
  operation: CeoBridgeRequest['operation'] = 'office.state',
  input: CeoBridgeRequest['input'] = {},
  actorId = 'fixture-ceo',
): CeoBridgeRequest {
  return {
    actorId,
    operation,
    input,
    requestId: randomUUID(),
    ...(CEO_OPERATIONS[operation][0] === 'control' ? { confirm: true } : {}),
  };
}
async function signed(
  value: unknown,
  options: {
    nonce?: string;
    stamp?: string;
    secret?: string;
    direction?: 'request' | 'response';
  } = {},
) {
  const raw = JSON.stringify(value),
    nonce = options.nonce ?? randomUUID(),
    stamp = options.stamp ?? String(Date.now());
  return {
    raw,
    headers: {
      host: 'office.example.org',
      'x-forwarded-proto': 'https',
      'content-type': 'application/json',
      'x-agexa-timestamp': stamp,
      'x-agexa-nonce': nonce,
      'x-agexa-signature': await ceoSignature(
        options.secret ?? SECRET,
        options.direction ?? 'request',
        stamp,
        nonce,
        raw,
      ),
    },
  };
}
async function call(value: unknown, options: Parameters<typeof signed>[1] = {}) {
  const s = await signed(value, options);
  return app.inject({
    method: 'POST',
    url: CEO_PATH,
    payload: s.raw,
    headers: s.headers,
    remoteAddress: '127.0.0.1',
  });
}
it('returns the real eight employees and signed state without permanent admin tokens or keys', async () => {
  const r = await call(envelope());
  expect(r.statusCode).toBe(200);
  expect(r.json().result.employees).toEqual(engine.snapshot().employees);
  expect(
    await ceoVerify(
      SECRET,
      'response',
      String(r.headers['x-agexa-timestamp']),
      String(r.headers['x-agexa-nonce']),
      r.body,
      String(r.headers['x-agexa-signature']),
    ),
  ).toBe(true);
  expect(r.body).not.toContain(SECRET);
  expect(r.body).not.toContain(ADMIN);
  expect(r.headers['cache-control']).toContain('no-store');
});
it.each(['wrong-key', 'old-time', 'bad-nonce', 'response-direction'])(
  'rejects %s authentication before business effects',
  async (mode) => {
    const request = envelope('operations.set', { body: { suspended: true } });
    const options =
      mode === 'wrong-key'
        ? { secret: SECRET + 'bad' }
        : mode === 'old-time'
          ? { stamp: String(Date.now() - 120000) }
          : mode === 'bad-nonce'
            ? { nonce: 'bad' }
            : { direction: 'response' as const };
    expect((await call(request, options)).statusCode).toBe(401);
    expect(engine.suspended).toBe(false);
  },
);
it.each(['browser', 'wrong-host', 'untrusted-hop', 'http', 'query'])(
  'denies the %s channel even with valid HMAC',
  async (mode) => {
    const s = await signed(envelope());
    const headers: Record<string, string> = { ...s.headers };
    if (mode === 'browser') headers.origin = 'https://agexa-flix.base44.app';
    if (mode === 'wrong-host') headers.host = 'evil.example';
    if (mode === 'http') headers['x-forwarded-proto'] = 'http';
    const r = await app.inject({
      method: 'POST',
      url: CEO_PATH + (mode === 'query' ? '?token=bad' : ''),
      payload: s.raw,
      headers,
      remoteAddress: mode === 'untrusted-hop' ? '198.51.100.20' : '127.0.0.1',
    });
    expect(r.statusCode).toBe(403);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  },
);
it('does not turn permanent legacy bearer credentials into bridge access or grant a signed unknown actor', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: CEO_PATH,
        headers: {
          host: 'office.example.org',
          'x-forwarded-proto': 'https',
          authorization: 'Bearer ' + ADMIN,
        },
        payload: {},
      })
    ).statusCode,
  ).toBe(401);
  expect((await call(envelope('office.state', {}, 'ordinary-user'))).statusCode).toBe(403);
});
it('keeps readers read-only and requires explicit confirmation for control', async () => {
  expect((await call(envelope('office.state', {}, 'fixture-reader'))).statusCode).toBe(200);
  expect(
    (await call(envelope('operations.set', { body: { suspended: true } }, 'fixture-reader')))
      .statusCode,
  ).toBe(403);
  const unconfirmed = envelope('operations.set', { body: { suspended: true } });
  delete unconfirmed.confirm;
  expect((await call(unconfirmed)).statusCode).toBe(400);
  expect(engine.suspended).toBe(false);
});
it('durably rejects nonce replay, including after process restart', async () => {
  const request = envelope(),
    nonce = randomUUID();
  expect((await call(request, { nonce })).statusCode).toBe(200);
  await app.close();
  await start();
  expect((await call(request, { nonce })).statusCode).toBe(409);
});
it('deduplicates a Nexus order across fresh transport nonces and restart without bypassing the workflow', async () => {
  const request = envelope('nexus.command', {
    body: {
      goal: 'TEST fixture plan for an authorized business',
      input: { company: 'FICTÍCIO', authorized: true },
    },
  });
  const first = await call(request);
  expect(first.statusCode).toBe(201);
  const firstId = first.json().result.id;
  await app.close();
  await start();
  const duplicate = await call(request);
  expect(duplicate.statusCode).toBe(201);
  expect(duplicate.json().result.id).toBe(firstId);
  expect(engine.conversion.store.db.prepare('SELECT count(*) n FROM workflows').get()?.n).toBe(1);
  expect(
    (await call({ ...request, input: { body: { goal: 'Changed goal', input: {} } } })).statusCode,
  ).toBe(409);
});
it('refuses uncertain or expired command results rather than repeating side effects', async () => {
  const request = envelope('operations.set', { body: { suspended: true } });
  const store = new CeoStore(engine.conversion.store.db);
  store.reserve(request.requestId, request.actorId, JSON.stringify(request));
  expect((await call(request)).statusCode).toBe(409);
  expect(engine.suspended).toBe(false);
});
it('expires cached command responses without executing them again and accepts reordered equivalent content', async () => {
  const request = envelope('operations.set', { body: { suspended: true } });
  expect((await call(request)).statusCode).toBe(200);
  const reordered = {
    input: request.input,
    requestId: request.requestId,
    confirm: true,
    operation: request.operation,
    actorId: request.actorId,
  };
  expect((await call(reordered)).statusCode).toBe(200);
  engine.conversion.store.db
    .prepare('UPDATE ceo_commands SET created=? WHERE id=?')
    .run(Date.now() - 86400001, request.requestId);
  expect((await call(request)).statusCode).toBe(409);
});
it('keeps every original table and identifier unchanged when enabling bridge infrastructure', async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
  await start(null);
  const db = engine.conversion.store.db;
  const original = Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => [
        String(row.name),
        JSON.stringify(
          db
            .prepare(
              'SELECT * FROM "' + String(row.name).replaceAll('"', '""') + '" ORDER BY rowid',
            )
            .all(),
        ),
      ]),
  );
  await app.close();
  await start();
  for (const [table, rows] of Object.entries(original))
    expect(
      JSON.stringify(
        engine.conversion.store.db
          .prepare('SELECT * FROM "' + table.replaceAll('"', '""') + '" ORDER BY rowid')
          .all(),
      ),
    ).toBe(rows);
  expect(
    engine.conversion.store.db
      .prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'ceo_%'")
      .get()?.n,
  ).toBe(4);
});
it('keeps Orion reports distinct from other employees and lists persisted Nexus workflows', async () => {
  const report = engine.create({
    employeeId: 'orion',
    kind: 'sales_report',
    objective: 'TEST internal report',
    input: { authorized: true },
  });
  engine.setEmployee('orion', true);
  await engine.tick();
  await vi.waitFor(() => expect(engine.getTask(report.id).status).toBe('completed'));
  const reports = (await call(envelope('reports.orion'))).json().result;
  expect(reports.total).toBe(1);
  expect(reports.items[0].id).toBe(report.id);
  const order = await call(
    envelope('nexus.command', {
      body: { goal: 'TEST authorized plan', input: { authorized: true } },
    }),
  );
  expect(order.statusCode).toBe(201);
  const nexus = (await call(envelope('nexus.workflows'))).json().result;
  expect(
    nexus.workflows.some((workflow: { id: string }) => workflow.id === order.json().result.id),
  ).toBe(true);
});
it('audits denied authentication without recording attacker payloads or signatures', async () => {
  const bad = await signed(envelope(), { secret: 'WRONG-TEST-KEY-NOT-A-REAL-SECRET' });
  const response = await app.inject({
    method: 'POST',
    url: CEO_PATH,
    payload: bad.raw,
    headers: bad.headers,
  });
  expect(response.statusCode).toBe(401);
  const audit = (await call(envelope('audit.list'))).json().result;
  expect(audit[0]).toMatchObject({ actor: 'untrusted', operation: 'auth.denied', status: 401 });
  expect(JSON.stringify(audit)).not.toContain(bad.headers['x-agexa-signature']);
});
it('uses the original approval and cancellation services and records safe audit metadata', async () => {
  const task = engine.create({
    employeeId: 'atlas',
    kind: 'qualify_company',
    objective: 'TEST authorized fixture',
    input: { company: 'FICTÍCIO', authorized: true },
    requiresApproval: true,
  });
  expect(task.status).toBe('awaiting_approval');
  expect((await call(envelope('task.approve', { params: { id: task.id } }))).statusCode).toBe(200);
  expect(engine.getTask(task.id).approvedAt).not.toBeNull();
  expect((await call(envelope('task.cancel', { params: { id: task.id } }))).statusCode).toBe(200);
  expect(engine.getTask(task.id).status).toBe('cancelled');
  const audit = (await call(envelope('audit.list'))).json().result;
  expect(audit[0]).toMatchObject({ actor: 'fixture-ceo', operation: 'task.cancel', status: 200 });
  expect(JSON.stringify(audit)).not.toContain('FICTÍCIO');
  expect(JSON.stringify(audit)).not.toContain(SECRET);
});
it('paginates and filters tasks beyond the latest snapshot and exposes genuine integration states', async () => {
  for (let n = 0; n < 30; n++)
    engine.create({
      employeeId: 'atlas',
      kind: 'qualify_company',
      objective: 'TEST ' + n,
      input: { authorized: true },
      requiresApproval: true,
    });
  const page = (
    await call(envelope('tasks.list', { query: { status: 'awaiting_approval', page: 2 } }))
  ).json().result;
  expect(page.total).toBe(30);
  expect(page.items).toHaveLength(5);
  expect(page.pageSize).toBe(25);
  const integration = (await call(envelope('integrations.state'))).json().result;
  expect(integration.ia.connected).toBe(false);
  expect(integration.base44.lastSync).toBeNull();
  expect(integration.whatsapp.status).toBe('disabled');
});
it.each([
  'terminal.exec',
  'sql.query',
  'secrets.read',
  'conversion.manual',
  'message.send',
  '/api/agexa/state',
])('rejects the unsupported capability %s', async (operation) => {
  expect((await call({ ...envelope(), operation })).statusCode).toBe(400);
});
it('blocks path traversal and rejects oversized bodies', async () => {
  expect((await call(envelope('tasks.get', { params: { id: '../../terminal' } }))).statusCode).toBe(
    400,
  );
  expect((await call({ ...envelope(), extra: 'x' })).statusCode).toBe(400);
  expect(
    (await call(envelope('nexus.command', { body: { goal: 'x'.repeat(40000), input: {} } })))
      .statusCode,
  ).toBe(413);
});
it('enforces a durable per-actor limit and a bounded unauthenticated global limit', async () => {
  engine.conversion.store.db
    .prepare('INSERT INTO ceo_limits VALUES (?,?,?)')
    .run('fixture-ceo', Math.floor(Date.now() / 60000), 60);
  expect((await call(envelope())).statusCode).toBe(429);
  const request = await signed(envelope());
  let result;
  for (let n = 0; n < 301; n++)
    result = await app.inject({
      method: 'POST',
      url: CEO_PATH,
      headers: { ...request.headers, 'x-agexa-signature': 'bad' },
      payload: request.raw,
    });
  expect(result?.statusCode).toBe(429);
});
it('is disabled by default without creating bridge tables in the original database', async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
  await start(null);
  expect((await call(envelope())).statusCode).toBe(503);
  expect(
    engine.conversion.store.db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'ceo_%'")
      .all(),
  ).toHaveLength(0);
});
it('validates deployment configuration without inventing hosts, CEO IDs or key material', () => {
  expect(ceoConfig({})).toBeNull();
  expect(() => ceoConfig({ AGEXA_CEO_BRIDGE_ENABLED: '1' })).toThrow();
  expect(() =>
    ceoConfig({ AGEXA_CEO_BRIDGE_ENABLED: '1', AGEXA_OFFICE_PUBLIC_ORIGIN: 'http://example.org' }),
  ).toThrow();
  const cfg = ceoConfig({
    AGEXA_CEO_BRIDGE_ENABLED: '1',
    AGEXA_OFFICE_PUBLIC_ORIGIN: 'https://office.example.org',
    AGEXA_CEO_READ_IDS: 'fixture-reader',
  });
  expect(cfg?.secret()).toBe('');
  expect(cfg?.actors.get('fixture-reader')).toBe('read');
});
function bff(authenticate = vi.fn(async () => ({ id: 'fixture-ceo' })), fetcher?: typeof fetch) {
  return createOfficeGateway({
    officeOrigin: config.publicOrigin,
    frontendOrigin: 'https://agexa-flix.base44.app',
    actors,
    secret: SECRET,
    authenticate,
    fetcher:
      fetcher ??
      (async (url, options) => {
        const headers = Object.fromEntries(Object.entries(options?.headers ?? {})) as Record<
          string,
          string
        >;
        const response = await app.inject({
          method: 'POST',
          url: new URL(String(url)).pathname,
          headers: { ...headers, host: 'office.example.org', 'x-forwarded-proto': 'https' },
          payload: String(options?.body),
          remoteAddress: '127.0.0.1',
        });
        return new Response(response.body, {
          status: response.statusCode,
          headers: response.headers as Record<string, string>,
        });
      }),
  });
}
function browser(value: unknown) {
  return new Request('https://fixture-base44-function.example.org', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://agexa-flix.base44.app' },
    body: JSON.stringify(value),
  });
}
function browserEnvelope(): CeoBrowserRequest {
  return { operation: 'office.state', requestId: randomUUID(), input: {} };
}
it('runs the BFF→Office chain with server-authenticated identity and keeps all upstream credentials out of the browser', async () => {
  const r = await bff()(browser(browserEnvelope()));
  expect(r.status).toBe(200);
  const text = await r.text();
  expect(JSON.parse(text).result.employees).toHaveLength(8);
  expect(text).not.toContain(ADMIN);
  expect(text).not.toContain(SECRET);
  expect(r.headers.has('X-Agexa-Signature')).toBe(false);
});
it('denies ordinary and expired Base44 sessions before any Office request', async () => {
  const fetcher = vi.fn();
  expect(
    (
      await bff(
        vi.fn(async () => ({ id: 'ordinary-user' })),
        fetcher,
      )(browser(browserEnvelope()))
    ).status,
  ).toBe(403);
  expect(
    (
      await bff(
        vi.fn(async () => {
          throw Error('Expired');
        }),
        fetcher,
      )(browser(browserEnvelope()))
    ).status,
  ).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
it('refuses actor impersonation, browser routes and foreign origins in the BFF', async () => {
  const fetcher = vi.fn(),
    handler = bff(undefined, fetcher);
  expect((await handler(browser({ ...browserEnvelope(), actorId: 'fixture-ceo' }))).status).toBe(
    400,
  );
  expect(
    (await handler(browser({ ...browserEnvelope(), url: 'https://evil.example' }))).status,
  ).toBe(400);
  const foreign = browser(browserEnvelope());
  foreign.headers.set('Origin', 'https://evil.example');
  expect((await handler(foreign)).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects tampered, unsigned and unavailable upstream responses without fabricating Office state', async () => {
  for (const fetcher of [
    vi.fn(async () => new Response('{}', { status: 200 })),
    vi.fn(async () => {
      throw Error('PRIVATE ' + SECRET);
    }),
  ]) {
    const response = await bff(undefined, fetcher)(browser(browserEnvelope()));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(SECRET);
  }
});
