import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_INTELLIGENCE } from '../../core/src/intelligence.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { OllamaInferenceAdapter } from '../src/agexa/ollama.js';
import { mockOllama } from './helpers/mockOllama.js';

let root: string;
let engine: SalesEngine;
let mock: Awaited<ReturnType<typeof mockOllama>>;
async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) {
    const failed = engine.snapshot().tasks.find((t) => t.status === 'error');
    if (failed) throw Error(failed.error ?? 'Falha de inferência CRM');
    if (Date.now() > end) throw Error('CRM inference timeout');
    await engine.tick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-ai-'));
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
describe('CRM AI integration — simulated HTTP model only', () => {
  it('stores Atlas narrative separately from suitability rules and associates Maya versions with the lead', async () => {
    const source = engine.crm.createSource({
      name: 'Fixture',
      kind: 'manual',
      url: null,
      termsUrl: null,
      permissionEvidence: 'Autorização de teste',
      attribution: 'Teste',
      enabled: true,
      termsReviewed: true,
      commercialReuseAllowed: true,
    });
    const id = engine.crm.importCompanies(
      [
        {
          name: 'Empresa de teste',
          sector: 'barbearia',
          city: 'Beira',
          country: 'Moçambique',
          usesAppointments: true,
          organizationNeed: true,
          hasSchedulingSystem: false,
          sufficientInfo: true,
        },
      ],
      source.id,
      'fixture',
      'provided',
    ).companyIds[0];
    const rules = engine.queueCrmWork(id, 'atlas', false);
    await until(() => engine.getTask(rules.id).status === 'completed');
    const ai = engine.queueCrmWork(id, 'atlas', true);
    await until(() => engine.getTask(ai.id).status === 'completed');
    expect(engine.crm.company(id).score).toBe(100);
    expect(
      engine.crm.detail(id).qualifications.some((q) => q.mode === 'test' && q.score === null),
    ).toBe(true);
    mock.control.draft = 'SIMULAÇÃO: abordagem de teste, sujeita a revisão.';
    const maya = engine.queueCrmWork(id, 'maya', true);
    await until(() => engine.getTask(maya.id).status === 'completed');
    expect(engine.crm.drafts(id)[0]).toMatchObject({
      mode: 'test',
      companyId: id,
      taskId: maya.id,
      status: 'proposed',
    });
    expect(engine.crm.analytics().drafts).toBe(0);
    expect(engine.crm.company(id).stage).toBe('qualified');
    expect(mock.calls.find((c) => c.employeeId === 'maya')?.input.crmCompany).toMatchObject({
      id,
      contactOmitted: true,
    });
  });
  it('coordinates a bounded CRM order through eight employees with simulated inference and persists only internal materials', async () => {
    const source = engine.crm.createSource({
      name: 'CSV TESTE',
      kind: 'csv',
      url: null,
      termsUrl: null,
      permissionEvidence: 'Fixture empresarial autorizado',
      attribution: 'Teste',
      enabled: true,
      termsReviewed: true,
      commercialReuseAllowed: true,
    });
    const companyId = engine.crm.importCompanies(
      [
        {
          name: 'Clínica TESTE',
          sector: 'clínica',
          city: 'Beira',
          country: 'Moçambique',
          usesAppointments: true,
          organizationNeed: true,
          hasSchedulingSystem: false,
          sufficientInfo: true,
        },
      ],
      source.id,
      'fixture',
      'simulated',
    ).companyIds[0];
    mock.control.draft = 'SIMULAÇÃO INTERNA — material comercial sujeito a revisão.';
    const order = engine.createCommercialOrder(
      'Preparar materiais internos na Beira',
      source.id,
      '',
      'Beira',
      true,
    );
    await until(() => engine.getTask(order.planTaskId).status === 'completed');
    expect(mock.calls).toHaveLength(1);
    engine.approveCommercialOrder(order.id);
    await until(() => engine.crm.order(order.id).status === 'completed');
    const tasks = engine.crm.assignments(order.id).map((a) => engine.getTask(a.taskId));
    expect(new Set(tasks.map((t) => t.employeeId)).size).toBe(8);
    expect(tasks.every((t) => t.status === 'completed')).toBe(true);
    expect(tasks).toHaveLength(10);
    expect(mock.calls).toHaveLength(7);
    const drafts = engine.crm.drafts(companyId);
    expect(drafts).toHaveLength(4);
    expect(
      drafts.every((d) => d.mode === 'test' && d.internalOnly && d.status === 'proposed'),
    ).toBe(true);
    expect(engine.crm.analytics()).toMatchObject({
      companies: 0,
      simulatedCompanies: 1,
      drafts: 0,
      sentMessages: null,
      confirmedPaying: null,
    });
    expect(engine.crm.company(companyId).stage).toBe('qualified');
    expect(engine.crm.company(companyId).eligibility.allowed).toBe(false);
  });
});
