import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BusinessSource, CompanyInput } from '../../core/src/crm.js';
import { parseCompanyCsv } from '../src/agexa/crm/validation.js';
import { SalesEngine } from '../src/agexa/engine.js';

let root: string;
let engine: SalesEngine;
const sourceInput: Omit<BusinessSource, 'id' | 'createdAt'> = {
  name: 'Fonte de teste autorizada',
  kind: 'manual',
  url: null,
  termsUrl: null,
  permissionEvidence: 'Fixture empresarial autorizada pelo teste',
  attribution: 'Dados de teste',
  enabled: true,
  termsReviewed: true,
  commercialReuseAllowed: true,
};
const company: CompanyInput = {
  name: 'Barbearia Fixture',
  sector: 'barbearia',
  city: 'Beira',
  province: 'Sofala',
  country: 'Moçambique',
  contactChannel: 'email',
  businessContact: 'empresa@example.org',
  usesAppointments: true,
  organizationNeed: true,
  hasSchedulingSystem: false,
  sufficientInfo: true,
};
async function until(condition: () => boolean) {
  const end = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > end) throw Error('CRM task timeout');
    await engine.tick();
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
function add() {
  const source = engine.crm.createSource(sourceInput);
  const imported = engine.crm.importCompanies([company], source.id, 'fixture', 'provided');
  return { source, id: imported.companyIds[0] };
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agexa-crm-'));
  engine = new SalesEngine(root);
});
afterEach(() => {
  engine.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Persistent sales CRM without an LLM', () => {
  it('imports authorized companies through Hunter and skips duplicates without changing identifiers', async () => {
    const source = engine.crm.createSource(sourceInput);
    const first = engine.queueCrmImport(source.id, {
      authorized: true,
      businessOnly: true,
      records: [company],
    });
    await until(() => engine.getTask(first.id).status === 'completed');
    const id = (engine.getTask(first.id).result!.companyIds as string[])[0];
    const again = engine.queueCrmImport(source.id, {
      authorized: true,
      businessOnly: true,
      records: [{ ...company, name: 'BARBEARIA fixture' }],
    });
    await until(() => engine.getTask(again.id).status === 'completed');
    expect(engine.getTask(again.id).result).toMatchObject({
      created: 0,
      duplicates: 1,
      companyIds: [id],
    });
    expect(engine.crm.snapshot().totalCompanies).toBe(1);
  });
  it('parses quoted CSV and rejects malformed or oversized files atomically', async () => {
    const source = engine.crm.createSource({ ...sourceInput, kind: 'csv' });
    const csv =
      '\uFEFFname,sector,city,country,needs\r\n"Empresa, Lda",barbearia,Beira,Moçambique,"Horários\norganizados"';
    expect(parseCompanyCsv(csv)[0]).toMatchObject({
      name: 'Empresa, Lda',
      needs: 'Horários\norganizados',
    });
    const task = engine.queueCrmImport(source.id, { authorized: true, businessOnly: true, csv });
    await until(() => engine.getTask(task.id).status === 'completed');
    const bad = engine.queueCrmImport(source.id, {
      authorized: true,
      businessOnly: true,
      csv: 'name,city\n"unclosed,Beira',
    });
    await until(() => engine.getTask(bad.id).status === 'error');
    expect(engine.crm.snapshot().totalCompanies).toBe(1);
    expect(() => parseCompanyCsv('x'.repeat(48001))).toThrow('48 KB');
    expect(() => parseCompanyCsv('name,name\na,b')).toThrow('Cabeçalhos');
  });
  it('keeps suitability separate from per-channel consent and honors revocation', async () => {
    const { id } = add();
    const qualify = engine.queueCrmWork(id, 'atlas', false);
    await until(() => engine.getTask(qualify.id).status === 'completed');
    expect(engine.crm.company(id)).toMatchObject({
      score: 100,
      stage: 'qualified',
      eligibility: { allowed: false },
    });
    expect(() => engine.moveCrm(id, 'authorized')).toThrow('consentimento');
    engine.crm.consent(
      id,
      'email',
      'granted',
      'Opt-in comercial fornecido pelo CEO',
      'Formulário empresarial',
    );
    engine.moveCrm(id, 'authorized');
    expect(engine.crm.company(id).eligibility.allowed).toBe(true);
    engine.crm.consent(id, 'email', 'revoked', 'Pedido para parar', 'Pedido empresarial');
    expect(engine.crm.company(id).eligibility.allowed).toBe(false);
    expect(engine.crm.company(id).score).toBe(100);
  });
  it('records versioned internal drafts and never treats simulations as real conversations', async () => {
    const { id } = add();
    engine.saveKnowledge({
      signupUrl: null,
      trialAvailable: false,
      trialDays: 7,
      confirmedFeatures: ['Gestão de marcações'],
      approvedPrices: [],
      policies: [],
    });
    const maya = engine.queueCrmWork(id, 'maya', false);
    const luna = engine.queueCrmWork(id, 'luna', false);
    await until(() => [maya, luna].every((t) => engine.getTask(t.id).status === 'completed'));
    const drafts = engine.crm.drafts(id);
    expect(drafts).toHaveLength(2);
    expect(drafts.find((d) => d.kind === 'simulation')!.body).toContain('SIMULAÇÃO INTERNA');
    expect(engine.crm.company(id).stage).toBe('identified');
    expect(() => engine.moveCrm(id, 'conversation')).toThrow('consentimento');
    const approach = drafts.find((d) => d.kind === 'approach')!;
    expect(() => engine.crm.reviewDraft(approach.id, 'approved')).toThrow('consentimento');
    engine.crm.consent(id, 'email', 'granted', 'Opt-in', 'Formulário');
    engine.crm.reviewDraft(approach.id, 'approved');
    engine.moveCrm(id, 'prepared');
    const next = engine.saveManualDraft(
      id,
      'maya',
      'approach',
      'Olá! Somos do Agexa. Podemos esclarecer as funcionalidades confirmadas?',
    );
    expect(next.version).toBe(2);
  });
  it('guards invitations and handoff completion with confirmed offer and independently recorded events', () => {
    const { id } = add();
    expect(() =>
      engine.saveManualDraft(
        id,
        'sophia',
        'invitation',
        'Testa grátis durante 7 dias em https://inventado.example',
      ),
    ).toThrow();
    const handoff = engine.prepareHandoff(id);
    expect(handoff).toMatchObject({ status: 'prepared', completed: false });
    engine.crm.consent(id, 'email', 'granted', 'Opt-in', 'Formulário');
    const verification = {
      independentlyVerified: true,
      evidence: 'Recibo externo confirmado manualmente pelo CEO',
      occurredAt: new Date().toISOString(),
    };
    expect(() => engine.moveCrm(id, 'ceo', verification)).toThrow('conversa');
    engine.moveCrm(id, 'conversation', verification);
    engine.moveCrm(id, 'interested', verification);
    expect(() => engine.moveCrm(id, 'link_sent', verification)).toThrow('URL e oferta');
    engine.saveKnowledge({
      signupUrl: 'https://cadastro.example.org/',
      trialAvailable: true,
      trialDays: 7,
      confirmedFeatures: [],
      approvedPrices: [],
      policies: [],
    });
    engine.moveCrm(id, 'link_sent', verification);
    engine.moveCrm(id, 'ceo', verification);
    expect(engine.crm.company(id).stage).toBe('ceo');
    expect(engine.crm.analytics().confirmedAccounts).toBeNull();
    expect(engine.crm.analytics().sentMessages).toBeNull();
    engine.moveCrm(id, 'account', verification);
    expect(engine.crm.analytics().confirmedAccounts).toBe(1);
  });
  it('persists companies, consent, pipeline and source evidence after restart', () => {
    const { id } = add();
    engine.crm.consent(id, 'email', 'granted', 'Opt-in de teste', 'Formulário');
    engine.moveCrm(id, 'authorized');
    engine.close();
    engine = new SalesEngine(root);
    expect(engine.crm.company(id)).toMatchObject({
      name: company.name,
      stage: 'authorized',
      eligibility: { allowed: true },
    });
    expect(engine.crm.detail(id).activities.length).toBeGreaterThan(1);
  });
  it('coordinates real source search and qualification before creating bounded materials for all roles', async () => {
    const { id, source } = add();
    engine.saveKnowledge({
      signupUrl: 'https://cadastro.example.org/',
      trialAvailable: true,
      trialDays: 7,
      confirmedFeatures: ['Gestão de marcações'],
      approvedPrices: [],
      policies: [],
    });
    const working = new Set<string>();
    engine.on('changed', () => {
      for (const e of engine.snapshot().employees) if (e.status === 'working') working.add(e.id);
    });
    const order = engine.createCommercialOrder(
      'Preparar oportunidades da Beira',
      source.id,
      'barbearia',
      'Beira',
      false,
    );
    await until(() => engine.getTask(order.planTaskId).status === 'completed');
    expect(engine.crm.assignments(order.id)).toHaveLength(1);
    engine.approveCommercialOrder(order.id);
    await until(() => engine.crm.order(order.id).status === 'completed');
    const assignments = engine.crm.assignments(order.id);
    expect(new Set(assignments.map((a) => a.employeeId)).size).toBe(8);
    expect(working.size).toBe(8);
    expect(assignments.length).toBeLessThanOrEqual(order.taskBudget);
    expect(engine.crm.drafts(id)).toHaveLength(4);
    expect(engine.crm.company(id).stage).toBe('qualified');
    expect(engine.crm.analytics().sentMessages).toBeNull();
    expect(() => engine.approveCommercialOrder(order.id)).toThrow('já aprovado');
  });
  it('does not manufacture leads or materials when a source search returns no companies', async () => {
    const source = engine.crm.createSource(sourceInput);
    const order = engine.createCommercialOrder('Pesquisar', source.id, 'clínica', 'Nampula', false);
    await until(() => engine.getTask(order.planTaskId).status === 'completed');
    engine.approveCommercialOrder(order.id);
    await until(() => engine.crm.order(order.id).status === 'completed');
    expect(engine.crm.snapshot().totalCompanies).toBe(0);
    expect(engine.crm.drafts()).toHaveLength(0);
    expect(engine.crm.assignments(order.id)).toHaveLength(5);
  });
  it('enforces authorization, source pause and research limits without partial inserts', async () => {
    const source = engine.crm.createSource(sourceInput);
    expect(() => engine.queueCrmImport(source.id, { records: [company] })).toThrow('autorização');
    engine.crm.saveSettings({ ...engine.crm.settings(), maxResearchPerHour: 1 });
    const first = engine.queueCrmImport(source.id, {
      authorized: true,
      businessOnly: true,
      records: [company],
    });
    await until(() => engine.getTask(first.id).status === 'completed');
    const second = engine.queueCrmImport(source.id, {
      authorized: true,
      businessOnly: true,
      records: [{ ...company, name: 'Outra' }],
    });
    await until(() => engine.getTask(second.id).status === 'error');
    expect(engine.crm.snapshot().totalCompanies).toBe(1);
    engine.crm.setSource(source.id, false);
    expect(() =>
      engine.queueCrmImport(source.id, {
        authorized: true,
        businessOnly: true,
        records: [company],
      }),
    ).toThrow('pausada');
  });
  it('exports spreadsheet formula cells as literal text and isolates simulated conversions', () => {
    const source = engine.crm.createSource(sourceInput);
    const ids = engine.crm.importCompanies(
      [{ ...company, name: '=HYPERLINK("bad")' }],
      source.id,
      'fixture',
      'simulated',
    ).companyIds;
    expect(engine.crm.exportCsv()).toContain("'=HYPERLINK");
    expect(engine.crm.analytics().companies).toBe(0);
    expect(() =>
      engine.moveCrm(ids[0], 'account', {
        independentlyVerified: true,
        evidence: 'Teste',
        occurredAt: new Date().toISOString(),
      }),
    ).toThrow('simulados');
  });
});
