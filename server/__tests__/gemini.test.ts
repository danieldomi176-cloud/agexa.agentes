/** Contract fixtures only: no Google call, genuine key, or real inference. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import type { SalesTask } from '../../core/src/agexa.js';
import { DEFAULT_INTELLIGENCE, type IntelligenceConfig } from '../../core/src/intelligence.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { SalesEngine } from '../src/agexa/engine.js';
import {
  GEMINI_ENDPOINT,
  GeminiInferenceAdapter,
  type GeminiTransport,
} from '../src/agexa/gemini.js';
import { ProviderInferenceAdapter } from '../src/agexa/inferenceProvider.js';
import { validateIntelligenceConfig } from '../src/agexa/ollama.js';
import { createHttpServer } from '../src/httpServer.js';

const cfg: IntelligenceConfig = {
  ...DEFAULT_INTELLIGENCE,
  provider: 'gemini',
  baseUrl: GEMINI_ENDPOINT,
  model: 'fixture-free-model',
  cloudAuthorized: true,
  freeTierConfirmed: true,
  dailyRequestLimit: 1,
};
const task: SalesTask = {
  id: 'fixture',
  kind: 'ai_request',
  employeeId: 'nexus',
  objective: 'TESTE: estratégia interna para barbearia fictícia na Beira.',
  input: { authorized: true },
  status: 'queued',
  priority: 0,
  createdAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
  parentId: null,
  approvedAt: null,
};
const context = () => ({ signal: new AbortController().signal, objective: 'TESTE interno' });
function fixture() {
  const calls: { route: string; body: unknown }[] = [];
  const control = { mode: 'valid' };
  const transport: GeminiTransport = async (route, body, signal, key) => {
    signal.throwIfAborted();
    expect(key).toBe('TEST_ONLY_NOT_A_REAL_KEY');
    calls.push({ route, body });
    if (body === undefined)
      return {
        models: [
          { name: 'models/fixture-free-model', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-only', supportedGenerationMethods: ['embedContent'] },
        ],
      };
    if (control.mode === 'quota') throw Error('Gemini HTTP 429: quota atingida');
    const result: Record<string, unknown> = {
      summary: 'SIMULAÇÃO: estratégia comercial interna',
      draft: '',
      observations: ['Dados fictícios'],
      nextActions: ['Revisão humana'],
    };
    if (control.mode === 'injection') result.shell = 'command';
    if (control.mode === 'offer') result.draft = 'Experimenta grátis 7 dias';
    return {
      candidates: [
        {
          finishReason: control.mode === 'truncated' ? 'MAX_TOKENS' : 'STOP',
          content: {
            parts: [
              { thought: true, text: 'TEST internal thought never stored' },
              { text: control.mode === 'invalid_json' ? 'not json' : JSON.stringify(result) },
            ],
          },
        },
      ],
    };
  };
  return {
    calls,
    control,
    adapter: new GeminiInferenceAdapter(cfg, transport, () => 'TEST_ONLY_NOT_A_REAL_KEY', true),
  };
}
let engine: SalesEngine | undefined, root: string | undefined;
afterEach(() => {
  engine?.close();
  engine = undefined;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});
it('keeps old local configuration valid and restricts cloud destination and limits', () => {
  expect(() => validateIntelligenceConfig(DEFAULT_INTELLIGENCE)).not.toThrow();
  for (const bad of [
    { baseUrl: 'https://evil.invalid' },
    { baseUrl: GEMINI_ENDPOINT + '/?key=secret' },
    { model: '../other' },
    { provider: 'paid-auto' },
    { dailyRequestLimit: 0 },
    { dailyRequestLimit: 101 },
  ])
    expect(() => validateIntelligenceConfig({ ...cfg, ...bad } as IntelligenceConfig)).toThrow();
});
it.each(['key', 'consent', 'free'] as const)(
  'blocks %s absence before any outgoing request',
  async (missing) => {
    let calls = 0;
    const adapter = new GeminiInferenceAdapter(
      { ...cfg, cloudAuthorized: missing !== 'consent', freeTierConfirmed: missing !== 'free' },
      async () => {
        calls++;
        return {};
      },
      () => (missing === 'key' ? '' : 'TEST_ONLY'),
    );
    const status = await adapter.probe();
    expect(status.connected).toBe(false);
    expect(status.error).toBeTruthy();
    await expect(adapter.run(task, context())).rejects.toThrow();
    expect(calls).toBe(0);
  },
);
it('lists generation models with no key in public status and never calls generation on probe', async () => {
  const f = fixture();
  await f.adapter.probe();
  await f.adapter.probe();
  expect(f.calls).toHaveLength(1);
  expect(f.adapter.status.models).toEqual(['fixture-free-model']);
  expect(f.adapter.status.executionMode).toBe('test');
  expect(JSON.stringify(f.adapter.status)).not.toContain('TEST_ONLY_NOT_A_REAL_KEY');
});
it('produces validated structured output while keeping injected transport evidence simulated', async () => {
  const f = fixture();
  const result = await f.adapter.run(task, context());
  expect(result).toMatchObject({
    executionMode: 'test',
    model: 'fixture-free-model',
    requiresHumanReview: true,
    delivery: 'internal_only',
  });
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(result)).not.toContain('internal thought');
  expect(f.calls[1].route).toBe('/v1beta/models/fixture-free-model:generateContent');
  const body = f.calls[1].body as Record<string, unknown>;
  expect(body).not.toHaveProperty('tools');
  expect(body.generationConfig).toMatchObject({
    responseMimeType: 'application/json',
    maxOutputTokens: 2048,
  });
});
it.each(['invalid_json', 'injection', 'offer', 'truncated', 'quota'])(
  'rejects %s without retry or alternate provider',
  async (mode) => {
    const f = fixture();
    f.control.mode = mode;
    await expect(f.adapter.run(task, context())).rejects.toThrow();
    expect(f.calls.filter((c) => c.body !== undefined)).toHaveLength(1);
  },
);
it('cancels before making a request', async () => {
  const f = fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(f.adapter.run(task, { signal: abort.signal, objective: 'TEST' })).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});
it('does not reuse a response/model list after configuration changes', async () => {
  const f = fixture();
  await f.adapter.probe();
  expect(f.adapter.connected).toBe(true);
  f.adapter.configure({ ...cfg, model: 'other-model' });
  expect(f.adapter.connected).toBe(false);
  expect(f.adapter.status.models).toEqual([]);
  await f.adapter.probe();
  expect(f.adapter.connected).toBe(false);
});
it('honors task cancellation during model discovery without sending task context', async () => {
  let generation = 0;
  const adapter = new GeminiInferenceAdapter(
    { ...cfg, timeoutMs: 50 },
    async (_route, body) => {
      if (body !== undefined) generation++;
      await new Promise((r) => setTimeout(r, 150));
      return { models: [] };
    },
    () => 'TEST_ONLY',
    true,
  );
  await expect(adapter.run(task, context())).rejects.toThrow(/timeout/);
  expect(generation).toBe(0);
});
it('routes local/cloud explicitly without falling back when the cloud is unavailable', async () => {
  const f = fixture();
  const router = new ProviderInferenceAdapter(DEFAULT_INTELLIGENCE, 'test', f.adapter);
  router.configure(cfg);
  await router.probe();
  expect(router.name).toBe('gemini');
  expect(router.connected).toBe(true);
  router.configure({ ...cfg, cloudAuthorized: false });
  await expect(router.run(task, context())).rejects.toThrow(/Autorizar/);
  expect(router.name).toBe('gemini');
  router.configure(DEFAULT_INTELLIGENCE);
  expect(router.name).toBe('ollama');
  expect(router.connected).toBe(false);
});
it('enforces the daily generation budget across restart, including failed attempts', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-budget-fixture-'));
  const f = fixture();
  const router = new ProviderInferenceAdapter(DEFAULT_INTELLIGENCE, 'test', f.adapter);
  engine = new SalesEngine(root, router);
  engine.configureIntelligence(cfg);
  await engine.refreshIntelligence();
  async function run() {
    const t = engine!.validateInference();
    const deadline = Date.now() + 4000;
    while (!['completed', 'error'].includes(engine!.getTask(t.id).status)) {
      if (Date.now() > deadline) throw Error('Cloud budget timeout');
      await engine!.tick();
      await new Promise((r) => setTimeout(r, 5));
    }
    return engine!.getTask(t.id);
  }
  f.control.mode = 'invalid_json';
  expect((await run()).status).toBe('error');
  expect(engine.snapshot().intelligence?.cloudUsage?.attempts).toBe(1);
  engine.close();
  engine = new SalesEngine(
    root,
    new ProviderInferenceAdapter(DEFAULT_INTELLIGENCE, 'test', f.adapter),
  );
  await engine.refreshIntelligence();
  const blocked = await run();
  expect(blocked.error).toMatch(/Limite diário/);
  expect(f.calls.filter((c) => c.body !== undefined)).toHaveLength(1);
  expect(engine.snapshot().intelligence?.cloudUsage?.attempts).toBe(1);
  expect(engine.operational.check().pilotReady).toBe(false);
});
it('keeps cloud configuration behind the admin boundary and rejects browser key fields', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-http-fixture-'));
  const f = fixture();
  engine = new SalesEngine(
    root,
    new ProviderInferenceAdapter(DEFAULT_INTELLIGENCE, 'test', f.adapter),
  );
  const { app } = await createHttpServer({
    embedded: true,
    token: 'TEST_TOKEN_ONLY',
    store: new AgentStateStore(),
    salesEngine: engine,
  });
  const headers = { host: '127.0.0.1', authorization: 'Bearer TEST_TOKEN_ONLY' };
  try {
    expect(
      (await app.inject({ method: 'POST', url: '/api/agexa/intelligence/config', payload: cfg }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/intelligence/config',
          headers: { ...headers, origin: 'https://evil.invalid' },
          payload: cfg,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/intelligence/config',
          headers,
          payload: { ...cfg, apiKey: 'TEST_ONLY_NEVER_BROWSER' },
        })
      ).statusCode,
    ).toBe(400);
    const saved = await app.inject({
      method: 'POST',
      url: '/api/agexa/intelligence/config',
      headers,
      payload: cfg,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('TEST_ONLY_NOT_A_REAL_KEY');
    expect(saved.json().intelligence.config.provider).toBe('gemini');
    expect(saved.json().intelligence.status.executionMode).toBe('test');
  } finally {
    await app.close();
  }
});
