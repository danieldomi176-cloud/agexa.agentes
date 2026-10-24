import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_INTELLIGENCE } from '../../core/src/intelligence.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { OllamaInferenceAdapter } from '../src/agexa/ollama.js';
import { createHttpServer } from '../src/httpServer.js';
import { mockOllama } from './helpers/mockOllama.js';

let app: FastifyInstance;
let engine: SalesEngine;
let root: string;
let mock: Awaited<ReturnType<typeof mockOllama>>;
const headers = { host: '127.0.0.1', authorization: 'Bearer phase-three-test-token' };
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-intel-routes-'));
  mock = await mockOllama();
  engine = new SalesEngine(root, new OllamaInferenceAdapter(DEFAULT_INTELLIGENCE, 'test'));
  const server = await createHttpServer({
    embedded: true,
    token: 'phase-three-test-token',
    store: new AgentStateStore(),
    salesEngine: engine,
  });
  app = server.app;
});
afterEach(async () => {
  await app.close();
  await mock.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Intelligence administrative boundary', () => {
  it('protects all new endpoints with the existing authentication and origin checks', async () => {
    for (const url of [
      '/api/agexa/intelligence/config',
      '/api/agexa/intelligence/probe',
      '/api/agexa/knowledge',
      '/api/agexa/decisions',
      '/api/agexa/commands',
      '/api/agexa/workflows/id/approve',
    ]) {
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { ...headers, origin: 'https://evil.invalid' },
            payload: {},
          })
        ).statusCode,
      ).toBe(401);
    }
  });
  it('verifies actual model availability and rejects SSRF-style addresses', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/intelligence/config',
          headers,
          payload: { ...DEFAULT_INTELLIGENCE, baseUrl: 'http://169.254.169.254' },
        })
      ).statusCode,
    ).toBe(400);
    const valid = await app.inject({
      method: 'POST',
      url: '/api/agexa/intelligence/config',
      headers,
      payload: { ...DEFAULT_INTELLIGENCE, baseUrl: mock.url, model: 'agexa-test:tiny' },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().intelligence.status).toMatchObject({
      connected: true,
      executionMode: 'test',
    });
  });
  it('requires confirmed knowledge and authorizations before recording business facts or orders', async () => {
    const knowledge = {
      signupUrl: null,
      trialDays: 7,
      trialAvailable: true,
      confirmedFeatures: [],
      approvedPrices: [],
      policies: [],
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/knowledge',
          headers,
          payload: knowledge,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/commands',
          headers,
          payload: { goal: 'Plano de teste', input: {} },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/knowledge',
          headers,
          payload: { ...knowledge, trialAvailable: false },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/decisions',
          headers,
          payload: { content: '   ' },
        })
      ).statusCode,
    ).toBe(400);
    const decision = await app.inject({
      method: 'POST',
      url: '/api/agexa/decisions',
      headers,
      payload: { content: 'Usar somente factos autorizados', employeeId: 'maya' },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().intelligence.memories[0].kind).toBe('decision');
    const command = await app.inject({
      method: 'POST',
      url: '/api/agexa/commands',
      headers,
      payload: { goal: 'Plano de teste', input: { authorized: true } },
    });
    expect(command.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/agexa/workflows/${command.json().id}/approve`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
  });
  it('never exposes model download, messaging or arbitrary tool endpoints', async () => {
    for (const url of ['/api/agexa/intelligence/pull', '/api/agexa/send', '/api/agexa/shell'])
      expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(
        404,
      );
  });
});
