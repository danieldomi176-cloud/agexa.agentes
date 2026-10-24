/** Isolated fixtures. Injected models/transports never establish external availability. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { EMPLOYEES } from '../../core/src/agexa.js';
import { DEFAULT_INTELLIGENCE } from '../../core/src/intelligence.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { inferenceConfigurationDigest, OllamaInferenceAdapter } from '../src/agexa/ollama.js';
import { createHttpServer } from '../src/httpServer.js';
import { mockOllama } from './helpers/mockOllama.js';

let root: string, engine: SalesEngine, app: FastifyInstance;
const headers = { host: '127.0.0.1', authorization: 'Bearer readiness-test-token' };
const knowledge = {
  signupUrl: 'https://signup.example.org/',
  trialAvailable: false,
  trialDays: 7 as const,
  confirmedFeatures: ['Funcionalidade fictícia confirmada'],
  approvedPrices: [],
  policies: [],
};
const proof = {
  registrationEvidence: 'TESTE: cadastro e sete dias confirmados no sistema fictício.',
  startsWhen: 'TESTE: após criar a conta confirmada.',
  expiryBehaviour: 'TESTE: funções bloqueadas após expirar.',
  paymentRequired: true,
  includedFeatures: 'TESTE: apenas funcionalidades registadas.',
  confirmed: true as const,
};
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-unit-'));
  engine = new SalesEngine(root);
  app = (
    await createHttpServer({
      embedded: true,
      token: 'readiness-test-token',
      store: new AgentStateStore(),
      salesEngine: engine,
    })
  ).app;
});
afterEach(async () => {
  await app.close();
  engine.close();
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const post = (route: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/agexa/' + route,
    headers: { ...headers, 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });
it('reports missing integrations independently without promoting local components or manual facts to a ready pilot', () => {
  const r = engine.operational.check();
  expect(r.checks).toHaveLength(15);
  expect(new Set(r.checks.map((c) => c.id)).size).toBe(15);
  expect(r.pilotReady).toBe(false);
  expect(r.checks.find((c) => c.id === 'sqlite')?.state).toBe('VALIDADO');
  for (const id of ['model', 'nexus', 'base44', 'whatsapp', 'offer', 'backups'])
    expect(r.checks.find((c) => c.id === id)?.state).toBe('PENDENTE');
  expect(r.employees).toHaveLength(8);
});
it('protects every operational read and mutation using token, host and origin', async () => {
  expect((await app.inject({ url: '/api/agexa/readiness' })).statusCode).toBe(401);
  for (const route of [
    'readiness/check',
    'readiness/backup',
    'readiness/offer',
    'readiness/employees/nexus/inference',
  ]) {
    expect(
      (await app.inject({ method: 'POST', url: '/api/agexa/' + route, payload: {} })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agexa/' + route,
          headers: { ...headers, origin: 'https://evil.invalid' },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
  }
  expect(
    (
      await app.inject({
        url: '/api/agexa/readiness',
        headers: { ...headers, host: 'evil.invalid' },
      })
    ).statusCode,
  ).toBe(401);
  const r = await app.inject({ url: '/api/agexa/readiness', headers });
  expect(r.statusCode).toBe(200);
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.body).not.toContain('readiness-test-token');
});
it('cannot activate an unverified offer or bypass the evidence schema', async () => {
  expect((await post('knowledge', { ...knowledge, trialAvailable: true })).statusCode).toBe(409);
  expect((await post('readiness/offer', { ...proof, state: 'VALIDADO' })).statusCode).toBe(400);
  expect((await post('readiness/offer', { ...proof, confirmed: false })).statusCode).toBe(400);
  expect((await post('readiness/offer', proof)).statusCode).toBe(400);
  expect(engine.operational.offer().valid).toBe(false);
});
it('requires full evidence for the current knowledge and invalidates it after a configuration change', async () => {
  expect((await post('knowledge', knowledge)).statusCode).toBe(200);
  expect((await post('readiness/offer', proof)).statusCode).toBe(200);
  expect((await post('knowledge', { ...knowledge, trialAvailable: true })).statusCode).toBe(200);
  expect(engine.operational.offer()).toMatchObject({ valid: true, mode: 'manual' });
  expect(
    (
      await post('knowledge', {
        ...knowledge,
        trialAvailable: true,
        signupUrl: 'https://new.example.org/',
      })
    ).statusCode,
  ).toBe(409);
  await post('knowledge', { ...knowledge, signupUrl: 'https://new.example.org/' });
  expect(engine.operational.offer().valid).toBe(false);
  expect(engine.operational.check().checks.find((c) => c.id === 'offer')?.state).toBe('PENDENTE');
});
it('never reuses simulated offer proof after returning to operational mode', async () => {
  vi.stubEnv('AGEXA_MESSAGING_TEST_MODE', '1');
  await post('knowledge', knowledge);
  await post('readiness/offer', proof);
  expect(engine.operational.offer().mode).toBe('simulated');
  expect((await post('knowledge', { ...knowledge, trialAvailable: true })).statusCode).toBe(200);
  vi.stubEnv('AGEXA_MESSAGING_TEST_MODE', '0');
  expect((await post('knowledge', { ...knowledge, trialAvailable: true })).statusCode).toBe(409);
  expect(engine.operational.check().checks.find((c) => c.id === 'offer')?.state).toBe('PENDENTE');
});
it('creates a consistent private backup, detects tampering and restores only into an isolated directory', async () => {
  engine.saveKnowledge(knowledge);
  const result = await engine.operational.createBackup();
  expect(result.integrity).toBe('ok');
  expect(result).not.toHaveProperty('file');
  const dir = path.join(root, 'backups');
  const file = path.join(dir, fs.readdirSync(dir)[0]);
  expect(fs.statSync(file).mode & 0o077).toBe(0);
  expect(fs.statSync(dir).mode & 0o077).toBe(0);
  expect(engine.operational.check().checks.find((c) => c.id === 'backups')?.state).toBe('VALIDADO');
  const restored = fs.mkdtempSync(path.join(os.tmpdir(), 'restored-fixture-'));
  fs.copyFileSync(file, path.join(restored, 'sales.sqlite'));
  const copy = new SalesEngine(restored);
  try {
    expect(copy.operational.check().checks.find((c) => c.id === 'sqlite')?.state).toBe('VALIDADO');
    const db = new DatabaseSync(path.join(restored, 'sales.sqlite'), { readOnly: true });
    expect(
      JSON.parse(
        String(db.prepare("SELECT value FROM settings WHERE key='knowledge'").get()?.value),
      ),
    ).toEqual(knowledge);
    db.close();
  } finally {
    copy.close();
    fs.rmSync(restored, { recursive: true, force: true });
  }
  fs.appendFileSync(file, 'tampered');
  expect(engine.operational.check().checks.find((c) => c.id === 'backups')?.state).toBe('ERRO');
});
it('rejects a symlink backup destination and recovers after the directory is corrected', async () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-symlink-fixture-'));
  const link = path.join(root, 'backups');
  try {
    fs.symlinkSync(other, link, 'dir');
    await expect(engine.operational.createBackup()).rejects.toThrow(/simbólica/);
    expect(fs.readdirSync(other)).toHaveLength(0);
    fs.unlinkSync(link);
    expect((await engine.operational.createBackup()).integrity).toBe('ok');
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
});
it('persists audit history and offer evidence across restart without enabling an external service', async () => {
  await post('knowledge', knowledge);
  await post('readiness/offer', proof);
  engine.operational.recordCheck();
  await app.close();
  engine.close();
  engine = new SalesEngine(root);
  expect(engine.operational.check().history).toHaveLength(1);
  expect(engine.operational.offer().valid).toBe(true);
  expect(engine.operational.check().pilotReady).toBe(false);
});
it('records unavailable inference without starting fake employee tasks', async () => {
  for (const e of EMPLOYEES)
    expect((await post(`readiness/employees/${e.id}/inference`)).statusCode).toBe(409);
  expect(engine.snapshot().tasks).toHaveLength(0);
  expect(engine.conversion.snapshot().validations.every((v) => v.mode === 'unavailable')).toBe(
    true,
  );
  expect((await post('readiness/employees/intruder/inference')).statusCode).toBe(400);
});
it('does not run validation while operations are suspended', () => {
  engine.suspend(true);
  expect(() => engine.validateInference()).toThrow(/suspensas/);
  expect(engine.snapshot().tasks).toHaveLength(0);
});
it('recovers an interrupted task as an error without replaying inference', async () => {
  const t = engine.create({
    employeeId: 'nexus',
    kind: 'prepare_brief',
    objective: 'TESTE: recuperação',
    input: { authorized: true },
  });
  await app.close();
  engine.close();
  const db = new DatabaseSync(path.join(root, 'sales.sqlite'));
  db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(t.id);
  db.close();
  engine = new SalesEngine(root);
  expect(engine.getTask(t.id).status).toBe('error');
  expect(engine.getTask(t.id).error).toMatch(/interrompida/);
});
it('keeps endpoint/model provenance deterministic and invalidates changed endpoints', () => {
  expect(inferenceConfigurationDigest(DEFAULT_INTELLIGENCE)).toBe(
    inferenceConfigurationDigest({ ...DEFAULT_INTELLIGENCE }),
  );
  expect(inferenceConfigurationDigest(DEFAULT_INTELLIGENCE)).not.toBe(
    inferenceConfigurationDigest({ ...DEFAULT_INTELLIGENCE, baseUrl: 'http://127.0.0.1:11435' }),
  );
});
it('validates each employee JSON contract against an emulator while reporting zero real employee proofs', async () => {
  const mock = await mockOllama();
  await app.close();
  engine.close();
  engine = new SalesEngine(root, new OllamaInferenceAdapter(DEFAULT_INTELLIGENCE, 'test'));
  engine.configureIntelligence({
    ...DEFAULT_INTELLIGENCE,
    baseUrl: mock.url,
    model: 'agexa-test:tiny',
  });
  try {
    await engine.refreshIntelligence();
    for (const e of EMPLOYEES) {
      const task = engine.validateInference(e.id);
      const deadline = Date.now() + 4000;
      while (!['completed', 'error'].includes(engine.getTask(task.id).status)) {
        if (Date.now() > deadline) throw Error('Employee timeout');
        await engine.tick();
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(engine.getTask(task.id).status).toBe('completed');
    }
    const r = engine.operational.check();
    expect(r.employees.every((e) => e.mode === 'simulated')).toBe(true);
    expect(r.pilotReady).toBe(false);
    expect(r.checks.find((c) => c.id === 'model')?.state).toBe('PENDENTE');
    expect(mock.calls).toHaveLength(8);
    mock.control.mode = 'invalid_json';
    const failed = engine.validateInference('nexus');
    const deadline = Date.now() + 4000;
    while (!['completed', 'error'].includes(engine.getTask(failed.id).status)) {
      if (Date.now() > deadline) throw Error('Failed contract timeout');
      await engine.tick();
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(engine.operational.check().checks.find((c) => c.id === 'model')?.state).toBe('ERRO');
    expect(engine.operational.check().employees[0]).toMatchObject({
      status: 'error',
      mode: 'simulated',
      taskId: failed.id,
      model: 'agexa-test:tiny',
    });
    expect(engine.getTask(failed.id).durationMs).toBeGreaterThanOrEqual(0);
  } finally {
    await mock.close();
  }
});
