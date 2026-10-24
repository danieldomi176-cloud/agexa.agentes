import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { MockWhatsAppProvider } from '../src/agexa/messaging/mock.js';
import { createHttpServer } from '../src/httpServer.js';
let app: FastifyInstance, engine: SalesEngine, root: string;
const headers = { host: '127.0.0.1', authorization: 'Bearer messaging-test-only-token' };
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-routes-'));
  engine = new SalesEngine(root, undefined, new MockWhatsAppProvider());
  app = (
    await createHttpServer({
      embedded: true,
      token: 'messaging-test-only-token',
      store: new AgentStateStore(),
      salesEngine: engine,
    })
  ).app;
});
afterEach(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
});
it('protects inbox, private QR and mutations from missing credentials, foreign Origin and Host', async () => {
  for (const url of [
    '/messaging',
    '/messaging/qr',
    '/messaging/conversations',
    '/messaging/conversations/unknown',
  ])
    expect((await app.inject({ url: '/api/agexa' + url })).statusCode).toBe(401);
  for (const url of [
    '/messaging/config',
    '/messaging/connection',
    '/messaging/stop',
    '/messaging/drafts/unknown/send',
    '/messaging/conversations/unknown/work',
  ]) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa' + url,
          payload: {},
          headers: { ...headers, origin: 'https://evil.invalid' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa' + url,
          payload: {},
          headers: { ...headers, host: 'evil.invalid' },
        })
      ).statusCode,
    ).toBe(401);
  }
});
it('has no unauthenticated webhooks or production injection endpoint and validates privileged requests', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/agexa/messaging/test/inbound',
        headers,
        payload: { id: 'x', remoteId: '258840000001@c.us', body: 'fake' },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/agexa/messaging/webhook',
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/agexa/messaging/config',
        headers,
        payload: { provider: 'web_experimental', confirmedExperimental: false },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/agexa/messaging/mode',
        headers,
        payload: { mode: 'automatic' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/agexa/messaging/drafts/x/send',
        headers,
        payload: { confirmed: false },
      })
    ).statusCode,
  ).toBe(400);
});
it('runs real HTTP configuration, inbox search and global stop against a simulated provider', async () => {
  for (const [url, payload] of [
    ['config', { provider: 'mock', confirmedExperimental: false }],
    ['connection', { action: 'connect', confirmedExperimental: false }],
    ['suspension', { suspended: false }],
  ] as const) {
    expect(
      (await app.inject({ method: 'POST', url: '/api/agexa/messaging/' + url, headers, payload }))
        .statusCode,
    ).toBe(200);
  }
  const p = engine.messaging.activeProvider as MockWhatsAppProvider;
  p.receive('msg-1', '258840000001@c.us', 'Quero saber mais', 'Empresa TESTE');
  const inbox = await app.inject({
    url: '/api/agexa/messaging/conversations?search=TESTE&page=1',
    headers,
  });
  expect(inbox.statusCode).toBe(200);
  expect(inbox.json().items).toHaveLength(1);
  expect(inbox.headers['cache-control']).toBe('no-store');
  const id = inbox.json().items[0].id;
  engine.queueMessagingWork(id, 'luna', false);
  expect(
    (await app.inject({ method: 'POST', url: '/api/agexa/messaging/stop', headers, payload: {} }))
      .statusCode,
  ).toBe(200);
  expect(engine.suspended).toBe(true);
  expect(engine.snapshot().tasks[0].status).toBe('cancelled');
});
it('rejects messaging metadata injected through the generic task endpoint', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/agexa/tasks',
    headers,
    payload: {
      employeeId: 'luna',
      kind: 'ai_request',
      objective: 'Bad permissions',
      input: { authorized: true, messaging: { conversationId: 'x' } },
    },
  });
  expect(r.statusCode).toBe(400);
});
