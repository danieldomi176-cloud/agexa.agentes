import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { createHttpServer } from '../src/httpServer.js';
let root: string, engine: SalesEngine, app: FastifyInstance;
const headers = { host: '127.0.0.1', authorization: 'Bearer conversion-test-token' };
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'conversion-http-'));
  engine = new SalesEngine(root);
  app = (
    await createHttpServer({
      embedded: true,
      token: 'conversion-test-token',
      store: new AgentStateStore(),
      salesEngine: engine,
    })
  ).app;
});
afterEach(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
});
it('protects conversion reports, financial data, runtime checks and mutations with the existing admin boundary', async () => {
  for (const url of [
    '/conversion',
    '/conversion/events',
    '/conversion/audit',
    '/conversion/validation/readiness',
    '/conversion/handoffs/unknown',
  ])
    expect((await app.inject({ url: '/api/agexa' + url })).statusCode).toBe(401);
  for (const url of [
    '/conversion/manual',
    '/conversion/config',
    '/conversion/sync',
    '/conversion/events/unknown/resolve',
    '/conversion/validation/inference',
  ])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa' + url,
          headers: { ...headers, origin: 'https://evil.invalid' },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
  expect(
    (
      await app.inject({
        url: '/api/agexa/conversion',
        headers: { ...headers, host: 'evil.invalid' },
      })
    ).statusCode,
  ).toBe(401);
});
it('does not expose a public webhook or accept payment declarations without explicit independent confirmation', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/agexa/conversion/webhook',
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  const r = await app.inject({
    method: 'POST',
    url: '/api/agexa/conversion/manual',
    headers,
    payload: {
      companyId: 'unknown',
      confirmed: false,
      fact: {
        eventId: 'x',
        appId: 'manual-agexa',
        kind: 'payment_confirmed',
        occurredAt: new Date().toISOString(),
        accountId: 'a',
        evidence: 'Not verified',
      },
    },
  });
  expect(r.statusCode).toBe(400);
  expect(engine.conversion.snapshot().metrics.origins.manual.paying).toBe(0);
});
it('records a manual registration and duplicate through real HTTP handlers with a private no-cache response', async () => {
  const s = engine.crm.createSource({
    name: 'TEST',
    kind: 'manual',
    url: null,
    termsUrl: null,
    permissionEvidence: 'TEST',
    attribution: 'TEST',
    enabled: true,
    termsReviewed: true,
    commercialReuseAllowed: true,
  });
  const id = engine.crm.importCompanies([{ name: 'FICTÍCIO' }], s.id, 'fixture', 'provided')
    .companyIds[0];
  const payload = {
    companyId: id,
    confirmed: true,
    fact: {
      eventId: 'manual-http-1',
      appId: 'manual-agexa',
      kind: 'account_created',
      occurredAt: new Date().toISOString(),
      accountId: 'account-http',
      evidence: 'Audited manual test',
    },
  };
  const first = await app.inject({
    method: 'POST',
    url: '/api/agexa/conversion/manual',
    headers,
    payload,
  });
  expect(first.statusCode).toBe(201);
  const second = await app.inject({
    method: 'POST',
    url: '/api/agexa/conversion/manual',
    headers,
    payload,
  });
  expect(second.json()).toMatchObject({ id: first.json().id, duplicate: true });
  const state = await app.inject({ url: '/api/agexa/conversion', headers });
  expect(state.headers['cache-control']).toBe('no-store');
  expect(state.json().metrics.origins.manual.accounts).toBe(1);
  expect(state.json().metrics.origins.integration.accounts).toBe(0);
});
it('refuses unsafe integration URLs and does not expose a secret input in configuration', async () => {
  const value = engine.conversion.store.config();
  for (const endpoint of [
    'http://example.org',
    'https://127.0.0.1/',
    'https://public.example.org/?token=secret',
  ]) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/agexa/conversion/config',
      headers,
      payload: { ...value, endpoint },
    });
    expect(r.statusCode).toBe(400);
  }
  expect(
    (await app.inject({ url: '/api/agexa/conversion', headers })).json().config,
  ).not.toHaveProperty('secret');
});
it('blocks conversion metadata injection through generic task creation', async () => {
  for (const key of ['conversionValidation', 'conversionReview'])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/tasks',
          headers,
          payload: {
            employeeId: 'nexus',
            kind: 'ai_request',
            objective: 'Injected permissions',
            input: { authorized: true, [key]: true },
          },
        })
      ).statusCode,
    ).toBe(400);
});
