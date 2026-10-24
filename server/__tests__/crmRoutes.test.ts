import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { createHttpServer } from '../src/httpServer.js';

let app: FastifyInstance;
let engine: SalesEngine;
let root: string;
const headers = { host: '127.0.0.1', authorization: 'Bearer crm-test-only-token' };
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-api-'));
  engine = new SalesEngine(root);
  app = (
    await createHttpServer({
      embedded: true,
      token: 'crm-test-only-token',
      store: new AgentStateStore(),
      salesEngine: engine,
    })
  ).app;
});
afterEach(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
});
const source = {
  name: 'Fixture CSV',
  kind: 'csv',
  url: null,
  termsUrl: null,
  permissionEvidence: 'Lista autorizada de teste',
  attribution: 'Teste',
  enabled: true,
  termsReviewed: true,
  commercialReuseAllowed: true,
};
describe('CRM administrative HTTP boundary', () => {
  it('protects reads, exports and mutations against missing credentials and foreign origins', async () => {
    for (const url of ['/api/agexa/crm', '/api/agexa/crm/companies', '/api/agexa/crm/export'])
      expect((await app.inject({ url })).statusCode).toBe(401);
    for (const url of [
      '/api/agexa/crm/import',
      '/api/agexa/crm/sources',
      '/api/agexa/crm/settings',
      '/api/agexa/crm/orders',
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            payload: {},
            headers: { ...headers, origin: 'https://evil.invalid' },
          })
        ).statusCode,
      ).toBe(401);
  });
  it('requires source reuse permission and business-only import authorization', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/crm/sources',
          headers,
          payload: { ...source, commercialReuseAllowed: false },
        })
      ).statusCode,
    ).toBe(400);
    const created = await app.inject({
      method: 'POST',
      url: '/api/agexa/crm/sources',
      headers,
      payload: source,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/crm/import',
          headers,
          payload: { sourceId: id, csv: 'name\nTeste', authorized: true, businessOnly: false },
        })
      ).statusCode,
    ).toBe(400);
    const imported = await app.inject({
      method: 'POST',
      url: '/api/agexa/crm/import',
      headers,
      payload: {
        sourceId: id,
        csv: 'name,city\nEmpresa de teste,Beira',
        authorized: true,
        businessOnly: true,
      },
    });
    expect(imported.statusCode).toBe(201);
    await engine.tick();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const listed = await app.inject({
      url: '/api/agexa/crm/companies?search=Empresa&page=1',
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().total).toBe(1);
    const exportCsv = await app.inject({ url: '/api/agexa/crm/export', headers });
    expect(exportCsv.headers['content-type']).toContain('text/csv');
  });
  it('does not allow arbitrary stages, fabricated conversions or action injection through generic tasks', async () => {
    const s = engine.crm.createSource({ ...source, kind: 'manual' } as Parameters<
      typeof engine.crm.createSource
    >[0]);
    const id = engine.crm.importCompanies(
      [{ name: 'Fixture', city: 'Beira' }],
      s.id,
      'fixture',
      'provided',
    ).companyIds[0];
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/agexa/crm/companies/${id}/stage`,
          headers,
          payload: { stage: 'paying' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/agexa/crm/companies/${id}/work`,
          headers,
          payload: { employeeId: 'shell', useAI: false },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/tasks',
          headers,
          payload: {
            employeeId: 'maya',
            kind: 'ai_request',
            objective: 'x',
            input: { authorized: true, crm: { op: 'draft', companyId: id } },
          },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('rejects unsafe website sources and leaves unsupported directory providers disabled', async () => {
    for (const url of ['https://127.0.0.1', 'http://169.254.169.254', 'file:///etc/passwd'])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/agexa/crm/sources',
            headers,
            payload: { ...source, kind: 'website', url },
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/crm/sources',
          headers,
          payload: { ...source, kind: 'google_maps' },
        })
      ).statusCode,
    ).toBe(400);
  });
});
