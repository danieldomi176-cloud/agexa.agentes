/** Independent inference checks against a TEST emulator only. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { DEFAULT_INTELLIGENCE } from '../../core/src/intelligence.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { OllamaInferenceAdapter } from '../src/agexa/ollama.js';
import { mockOllama } from './helpers/mockOllama.js';
let root: string, engine: SalesEngine, mock: Awaited<ReturnType<typeof mockOllama>>;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'conversion-ai-'));
  mock = await mockOllama();
  engine = new SalesEngine(root, new OllamaInferenceAdapter(DEFAULT_INTELLIGENCE, 'test'));
  engine.configureIntelligence({
    ...DEFAULT_INTELLIGENCE,
    baseUrl: mock.url,
    model: 'agexa-test:tiny',
  });
  await engine.refreshIntelligence();
});
afterEach(async () => {
  engine.close();
  await mock.close();
  fs.rmSync(root, { recursive: true, force: true });
});
async function run() {
  const task = engine.validateInference();
  const end = Date.now() + 4000;
  while (!['completed', 'error'].includes(engine.getTask(task.id).status)) {
    if (Date.now() > end) throw Error('Validation timeout');
    await engine.tick();
    await new Promise((r) => setTimeout(r, 5));
  }
  return engine.getTask(task.id);
}
it('records model, duration and validated contract while keeping emulator proof separate from real inference', async () => {
  const task = await run();
  expect(task.status).toBe('completed');
  expect(mock.calls).toHaveLength(1);
  expect(engine.conversion.snapshot().validations[0]).toMatchObject({
    mode: 'simulated',
    status: 'contract_pass',
    taskId: task.id,
    model: 'agexa-test:tiny',
  });
  expect(engine.conversion.snapshot().validations[0].durationMs).toBeGreaterThanOrEqual(0);
});
it('records invalid model output as failure and cannot turn model statements into payment facts', async () => {
  mock.control.mode = 'invalid_json';
  expect((await run()).status).toBe('error');
  expect(engine.conversion.snapshot().validations[0].status).toBe('failed');
  expect(engine.conversion.snapshot().accounts).toHaveLength(0);
  expect(engine.conversion.snapshot().metrics.origins.integration.paying).toBe(0);
});
