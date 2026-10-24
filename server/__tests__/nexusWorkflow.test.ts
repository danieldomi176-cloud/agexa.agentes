import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_INTELLIGENCE } from '../../core/src/intelligence.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { OllamaInferenceAdapter } from '../src/agexa/ollama.js';
import { mockOllama } from './helpers/mockOllama.js';

let root: string;
let engine: SalesEngine;
let mock: Awaited<ReturnType<typeof mockOllama>>;
const input = {
  authorized: true,
  companies: [{ name: 'Empresa fictícia de teste', source: 'Fixture autorizada' }],
};
async function until(predicate: () => boolean) {
  const end = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('Workflow timed out');
    await engine.tick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-nexus-'));
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

describe('Nexus orchestration — simulated Ollama contract only', () => {
  it('runs nine separate requests with CEO approval and explicit dependencies across all eight employees', async () => {
    const workflow = engine.commandNexus('Estratégia para barbearias da Beira', input);
    await until(() => engine.snapshot().intelligence!.workflows[0].status === 'proposed');
    expect(mock.calls.map((c) => c.employeeId)).toEqual(['nexus']);
    expect(engine.snapshot().tasks).toHaveLength(1);
    engine.approveWorkflow(workflow.id);
    expect(() => engine.approveWorkflow(workflow.id)).toThrow('aguarda');
    await until(() => engine.snapshot().intelligence!.workflows[0].status === 'completed');
    expect(mock.calls.map((c) => c.employeeId)).toEqual([
      'nexus',
      'hunter',
      'atlas',
      'maya',
      'luna',
      'victor',
      'sophia',
      'orion',
      'nexus',
    ]);
    const tasks = engine.snapshot().tasks.filter((t) => t.workflowId === workflow.id);
    expect(tasks).toHaveLength(9);
    expect(
      tasks.every(
        (t) =>
          t.status === 'completed' &&
          t.model === 'agexa-test:tiny' &&
          t.result?.executionMode === 'test',
      ),
    ).toBe(true);
    expect(tasks.filter((t) => t.dependencyIds?.length)).toHaveLength(8);
    expect(
      engine.snapshot().intelligence!.memories.filter((m) => m.kind === 'summary'),
    ).toHaveLength(9);
    expect(JSON.stringify(tasks)).not.toContain('internal reasoning');
    expect(mock.calls.find((c) => c.employeeId === 'maya')!.input.upstreamResults).toMatchObject([
      { employeeId: 'atlas' },
    ]);
  });
  it('propagates a failed agent without running its downstream dependants', async () => {
    mock.control.failEmployee = 'maya';
    const workflow = engine.commandNexus('Estratégia', input);
    await until(() => engine.snapshot().intelligence!.workflows[0].status === 'proposed');
    engine.approveWorkflow(workflow.id);
    await until(() =>
      engine
        .snapshot()
        .tasks.filter((t) => t.workflowId === workflow.id)
        .every((t) => ['completed', 'error'].includes(t.status)),
    );
    expect(mock.calls.map((c) => c.employeeId)).toEqual(['nexus', 'hunter', 'atlas', 'maya']);
    expect(engine.snapshot().intelligence!.workflows[0].status).toBe('error');
    expect(engine.snapshot().tasks.find((t) => t.employeeId === 'maya')).toMatchObject({
      model: 'agexa-test:tiny',
      result: null,
    });
    expect(engine.snapshot().tasks.find((t) => t.employeeId === 'luna')?.error).toContain(
      'Etapa anterior',
    );
  });
  it('validates Nexus plans and prevents recursive or duplicated delegation', async () => {
    mock.control.mode = 'bad_plan';
    const workflow = engine.commandNexus('Estratégia', input);
    await until(() => engine.getTask(workflow.planTaskId).status === 'error');
    expect(() => engine.approveWorkflow(workflow.id)).toThrow();
    expect(engine.snapshot().tasks).toHaveLength(1);
  });
  it('cancels a running inference, discards late output and conserves the configured one-at-a-time limit', async () => {
    mock.control.delayMs = 300;
    engine.setEmployee('maya', true);
    engine.setEmployee('luna', true);
    const first = engine.create({
      employeeId: 'maya',
      kind: 'ai_request',
      objective: 'Draft',
      input,
    });
    const second = engine.create({
      employeeId: 'luna',
      kind: 'ai_request',
      objective: 'Reply',
      input,
    });
    await engine.tick();
    await until(() => mock.calls.length === 1);
    expect(engine.getTask(second.id).status).toBe('queued');
    engine.cancel(first.id);
    await until(() => engine.getTask(second.id).status === 'completed');
    expect(engine.getTask(first.id)).toMatchObject({ status: 'cancelled', result: null });
    expect(engine.getTask(first.id).durationMs).toBeTypeOf('number');
  });
  it('retains configuration, decisions, proposed plans and phase-two operations after restart', async () => {
    engine.addDecision('Priorizar apenas dados empresariais autorizados', 'maya');
    const old = engine.create({
      employeeId: 'atlas',
      kind: 'qualify_company',
      objective: 'Qualificar fixture',
      input: { authorized: true, company: 'Teste', source: 'Fixture', usesAppointments: true },
    });
    engine.setEmployee('atlas', true);
    await engine.tick();
    expect(engine.getTask(old.id).result?.score).toBe(40);
    const workflow = engine.commandNexus('Estratégia', input);
    await until(() => engine.getTask(workflow.planTaskId).status === 'completed');
    engine.close();
    engine = new SalesEngine(root, new OllamaInferenceAdapter(DEFAULT_INTELLIGENCE, 'test'));
    await engine.refreshIntelligence();
    expect(engine.getTask(old.id).result?.score).toBe(40);
    expect(engine.snapshot().intelligence!.workflows[0].status).toBe('proposed');
    expect(engine.snapshot().intelligence!.memories.some((m) => m.kind === 'decision')).toBe(true);
    engine.approveWorkflow(workflow.id);
    await until(() => engine.snapshot().intelligence!.workflows[0].status === 'completed');
  });
  it('adds columns to a genuine phase-two schema without changing completed user data or settings', () => {
    engine.close();
    const legacy = path.join(root, 'legacy');
    fs.mkdirSync(legacy);
    const db = new DatabaseSync(path.join(legacy, 'sales.sqlite'));
    db.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO settings VALUES('suspended','1');
   CREATE TABLE employees(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0); INSERT INTO employees VALUES('nexus',1);
   CREATE TABLE tasks(id TEXT PRIMARY KEY,employeeId TEXT,kind TEXT,objective TEXT,input TEXT,status TEXT,priority INTEGER,createdAt TEXT,startedAt TEXT,finishedAt TEXT,result TEXT,error TEXT,parentId TEXT,approvedAt TEXT,UNIQUE(parentId,employeeId));
   CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,employeeId TEXT,taskId TEXT,action TEXT,detail TEXT); PRAGMA user_version=1;`);
    db.prepare(
      'INSERT INTO tasks(id,employeeId,kind,objective,input,status,priority,createdAt,result) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      'legacy',
      'nexus',
      'prepare_brief',
      'Existing CEO task',
      '{"authorized":true}',
      'completed',
      5,
      '2026-01-01',
      '{"retained":true}',
    );
    db.close();
    engine = new SalesEngine(legacy);
    expect(engine.suspended).toBe(true);
    expect(engine.getTask('legacy')).toMatchObject({
      objective: 'Existing CEO task',
      result: { retained: true },
      status: 'completed',
    });
    expect(engine.snapshot().employees[0].enabled).toBe(true);
  });
  it('bounds pending commands and enforces the global queue limit', () => {
    for (let index = 0; index < 5; index++) engine.commandNexus(`Ordem ${index}`, input);
    expect(() => engine.commandNexus('Sexta ordem', input)).toThrow('cinco');
    expect(mock.calls).toHaveLength(0);
    for (let index = 0; index < 95; index++)
      engine.create({
        employeeId: 'atlas',
        kind: 'prepare_brief',
        objective: `Brief ${index}`,
        input,
      });
    expect(() => engine.commandNexus('Fila cheia', input)).toThrow('100');
  });
  it('cancels an approved workflow without executing its remaining dependants', async () => {
    const workflow = engine.commandNexus('Estratégia cancelável', input);
    await until(() => engine.snapshot().intelligence!.workflows[0].status === 'proposed');
    mock.control.delayMs = 300;
    engine.approveWorkflow(workflow.id);
    await until(() => mock.calls.length === 2);
    engine.cancelWorkflow(workflow.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await engine.tick();
    expect(engine.snapshot().intelligence!.workflows[0].status).toBe('cancelled');
    expect(
      engine.snapshot().tasks.every((t) => ['completed', 'cancelled'].includes(t.status)),
    ).toBe(true);
    expect(mock.calls).toHaveLength(2);
  });
});
