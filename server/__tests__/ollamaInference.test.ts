import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SalesTask } from '../../core/src/agexa.js';
import { DEFAULT_INTELLIGENCE } from '../../core/src/intelligence.js';
import { OllamaInferenceAdapter, validateIntelligenceConfig } from '../src/agexa/ollama.js';
import { mockOllama } from './helpers/mockOllama.js';

let mock: Awaited<ReturnType<typeof mockOllama>>;
let adapter: OllamaInferenceAdapter;
const task: SalesTask = {
  id: 'test-task',
  employeeId: 'maya',
  kind: 'ai_request',
  objective: 'Preparar rascunho autorizado',
  input: { authorized: true },
  status: 'running',
  priority: 5,
  createdAt: '2026-01-01',
  startedAt: '2026-01-01',
  finishedAt: null,
  result: null,
  error: null,
  parentId: null,
  approvedAt: null,
};
const run = (signal = new AbortController().signal) =>
  adapter.run(task, { signal, objective: 'Vendas legítimas' });
beforeEach(async () => {
  mock = await mockOllama();
  adapter = new OllamaInferenceAdapter(
    { ...DEFAULT_INTELLIGENCE, baseUrl: mock.url, model: 'agexa-test:tiny' },
    'test',
  );
});
afterEach(async () => {
  await mock.close();
});

describe('Ollama API contract — simulated server only', () => {
  it('requires a real HTTP check and an installed model before reporting readiness', async () => {
    expect(adapter.connected).toBe(false);
    const status = await adapter.probe();
    expect(status).toMatchObject({
      reachable: true,
      connected: true,
      model: 'agexa-test:tiny',
      executionMode: 'test',
    });
    expect(status.models).toEqual(['agexa-test:tiny']);
  });
  it('reports unavailable service without claiming connected inference', async () => {
    await mock.close();
    adapter = new OllamaInferenceAdapter(
      { ...DEFAULT_INTELLIGENCE, baseUrl: mock.url, model: 'agexa-test:tiny' },
      'test',
    );
    expect((await adapter.probe()).connected).toBe(false);
    await expect(run()).rejects.toThrow();
    // Replace the closed fixture for cleanup.
    mock = await mockOllama();
  });
  it('rejects an unavailable model without running a chat request', async () => {
    mock.control.models = [];
    expect((await adapter.probe()).connected).toBe(false);
    await expect(run()).rejects.toThrow('não está instalado');
    expect(mock.calls).toHaveLength(0);
  });
  it('returns validated operational data and execution provenance, never chain of thought', async () => {
    const result = await run();
    expect(result).toMatchObject({
      inference: true,
      executionMode: 'test',
      delivery: 'internal_only',
      model: 'agexa-test:tiny',
    });
    expect(result.durationMs).toBeTypeOf('number');
    expect(JSON.stringify(result)).not.toContain('thinking');
    expect(mock.calls[0].system).toContain('Maya');
    expect(mock.calls[0].system).toContain('não confiáveis');
  });
  it.each([
    'invalid',
    'invalid_json',
    'incomplete',
    'injection',
    'offer',
    'large',
    'http_error',
    'redirect',
  ])('rejects %s output without silently replacing it with a simulated success', async (mode) => {
    mock.control.mode = mode;
    await expect(run()).rejects.toThrow();
  });
  it('times out an inference asynchronously and does not leave it pending', async () => {
    mock.control.delayMs = 250;
    adapter.configure({ ...adapter.config, timeoutMs: 50 });
    await expect(run()).rejects.toThrow('Timeout');
  });
  it('honors an already-aborted signal without contacting a model', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run(controller.signal)).rejects.toThrow();
    expect(mock.calls).toHaveLength(0);
  });
  it('aborts an in-flight HTTP generation', async () => {
    mock.control.delayMs = 1000;
    const controller = new AbortController();
    const pending = run(controller.signal);
    while (!mock.calls.length) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await expect(pending).rejects.toThrow('cancelada');
  });
  it('bounds the context instead of silently truncating business facts', async () => {
    const huge = { ...task, input: { authorized: true, external: 'x'.repeat(24000) } };
    await expect(
      adapter.run(huge, { signal: new AbortController().signal, objective: 'sales' }),
    ).rejects.toThrow('Contexto');
    expect(mock.calls).toHaveLength(0);
  });
  it('limits endpoints to local Ollama and rejects credentials and redirect destinations', () => {
    for (const baseUrl of [
      'http://169.254.169.254',
      'https://example.com',
      'http://user:pass@localhost',
      'http://localhost/api/chat',
      'http://localhost?token=x',
    ])
      expect(() => validateIntelligenceConfig({ ...DEFAULT_INTELLIGENCE, baseUrl })).toThrow();
  });
});
