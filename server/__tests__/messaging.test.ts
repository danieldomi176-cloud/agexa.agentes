/** Isolated provider-contract fixtures. No WhatsApp account or messages to actual people. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SalesEngine } from '../src/agexa/engine.js';
import { MockWhatsAppProvider } from '../src/agexa/messaging/mock.js';
let root: string, engine: SalesEngine, mock: MockWhatsAppProvider;
const remote = '258840000001@c.us';
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-test-'));
  mock = new MockWhatsAppProvider();
  engine = new SalesEngine(root, undefined, mock);
  await engine.messaging.configure('mock');
  await engine.messaging.connect();
  await Promise.resolve();
  engine.messaging.suspend(false);
});
afterEach(() => {
  engine.close();
  fs.rmSync(root, { recursive: true, force: true });
});
function conversation(id = 'incoming-1', body = 'Gostaria de saber mais sobre o Agexa.') {
  mock.receive(id, remote, body);
  return engine.messaging.store.list('mock').items[0];
}
function company(c = conversation()) {
  const source = engine.crm.createSource({
    name: 'TESTE empresarial',
    kind: 'manual',
    url: null,
    termsUrl: null,
    permissionEvidence: 'Fixture autorizado',
    attribution: 'Teste',
    enabled: true,
    termsReviewed: true,
    commercialReuseAllowed: true,
  });
  const id = engine.crm.importCompanies(
    [
      {
        name: 'Empresa TESTE',
        city: 'Beira',
        country: 'Moçambique',
        sector: 'barbearia',
        contactChannel: 'whatsapp',
        businessContact: '+258 84 000 0001',
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
  engine.messaging.link(c.id, id);
  engine.crm.consent(id, 'whatsapp', 'granted', 'Opt-in fictício explícito', 'Teste');
  return id;
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('Message tasks timeout');
    await engine.tick();
    await new Promise((r) => setTimeout(r, 2));
  }
}
function knowledge() {
  engine.saveKnowledge({
    signupUrl: 'https://cadastro.example.org/',
    trialAvailable: true,
    trialDays: 7,
    confirmedFeatures: ['Gestão de marcações'],
    approvedPrices: [],
    policies: [],
  });
}
function approved(c = conversation()) {
  company(c);
  const d = engine.messaging.draft(c.id, 'Resposta manual do CEO');
  engine.messaging.review(d.id, 'approved');
  return d;
}
describe('Messaging backend — SIMULATED provider only', () => {
  it('connects explicitly in assisted mode and never invents inbox messages', () => {
    expect(engine.messaging.snapshot().connection).toMatchObject({
      status: 'connected',
      mode: 'assisted',
      simulated: true,
    });
    expect(engine.messaging.store.list('mock').total).toBe(0);
    expect(mock.sends).toHaveLength(0);
  });
  it('deduplicates provider IDs without duplicate business events', () => {
    const c = conversation();
    mock.receive('incoming-1', remote, 'duplicado');
    expect(engine.messaging.store.detail(c.id).messages).toHaveLength(1);
    expect(
      engine.messaging.store.audits(c.id).filter((e) => e.action === 'message_received'),
    ).toHaveLength(1);
  });
  it('requires an explicitly matching CRM number and keeps simulations separate', () => {
    const c = conversation();
    const id = company(c);
    expect(engine.messaging.store.conversation(c.id).companyId).toBe(id);
    engine.crm.updateCompany(id, {
      name: 'Empresa TESTE',
      city: 'Beira',
      country: 'Moçambique',
      contactChannel: 'email',
      businessContact: 'test@example.org',
    });
    expect(() => engine.messaging.link(c.id, id)).toThrow(/mesmo contacto/);
  });
  it('requires per-channel consent even after receiving a message', () => {
    const c = conversation();
    const d = engine.messaging.draft(c.id, 'Resposta manual');
    expect(() => engine.messaging.review(d.id, 'approved')).toThrow(/Associar/);
    const id = company(c);
    engine.crm.consent(id, 'whatsapp', 'revoked', 'Revogação TESTE', 'Teste');
    expect(() => engine.messaging.review(d.id, 'approved')).toThrow(/consentimento/);
  });
  it('rejects a draft without permitting a send and records approval actor', async () => {
    const c = conversation();
    company(c);
    const d = engine.messaging.draft(c.id, 'Texto pendente');
    engine.messaging.review(d.id, 'rejected');
    await expect(engine.messaging.send(d.id)).rejects.toThrow(/aprovação/);
    expect(mock.sends).toHaveLength(0);
    expect(
      engine.messaging.store.db
        .prepare('SELECT actor,decision FROM messaging_approvals WHERE draftId=?')
        .get(d.id),
    ).toMatchObject({ actor: 'ceo', decision: 'rejected' });
  });
  it('sends the exact approved version once and never counts it as real', async () => {
    const d = approved();
    await engine.messaging.send(d.id);
    await expect(engine.messaging.send(d.id)).rejects.toThrow();
    expect(mock.sends).toHaveLength(1);
    expect(mock.sends[0].body).toBe(d.body);
    expect(engine.messaging.snapshot().metrics).toMatchObject({
      confirmedRealSends: 0,
      confirmedSimulatedSends: 1,
    });
  });
  it('prevents concurrent sends in the same conversation', async () => {
    const c = conversation();
    const a = approved(c);
    const b = engine.messaging.draft(c.id, 'Outra versão aprovada');
    engine.messaging.review(b.id, 'approved');
    const outcomes = await Promise.allSettled([
      engine.messaging.send(a.id),
      engine.messaging.send(b.id),
    ]);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(mock.sends).toHaveLength(1);
  });
  it('invalidates an approval when a newer inbound message arrives', async () => {
    const d = approved();
    mock.receive('new-inbound', remote, 'Outra pergunta');
    await expect(engine.messaging.send(d.id)).rejects.toThrow(/desatualizado/);
    expect(mock.sends).toHaveLength(0);
  });
  it('rechecks live consent and global/channel suspension immediately before send', async () => {
    const c = conversation();
    const d = approved(c);
    engine.messaging.suspend(true);
    await expect(engine.messaging.send(d.id)).rejects.toThrow(/suspens/);
    engine.messaging.suspend(false);
    engine.suspend(true);
    await expect(engine.messaging.send(d.id)).rejects.toThrow(/suspens/);
    engine.suspend(false);
    engine.crm.consent(
      engine.messaging.store.conversation(c.id).companyId!,
      'whatsapp',
      'revoked',
      'Teste revogado',
      'Teste',
    );
    await expect(engine.messaging.send(d.id)).rejects.toThrow(/consentimento/);
  });
  it.each(['error', 'ambiguous'] as const)(
    'keeps %s failures in reconciliation and refuses blind retries',
    async (outcome) => {
      const d = approved();
      mock.outcome = outcome;
      await engine.messaging.send(d.id);
      expect(engine.messaging.store.draft(d.id).status).toBe('reconciliation');
      await expect(engine.messaging.send(d.id)).rejects.toThrow(/bloqueada/);
      expect(mock.sends).toHaveLength(1);
      const delivery = engine.messaging.deliveries(d.conversationId)[0] as { id: string };
      engine.messaging.reconcile(delivery.id, 'not_sent', 'Confirmação independente TESTE');
      expect(engine.messaging.store.draft(d.id).status).toBe('failed');
    },
  );
  it('does not treat provider identifiers as confirmed delivery; deduplicates receipts', async () => {
    const d = approved();
    mock.outcome = 'pending';
    await engine.messaging.send(d.id);
    expect(engine.messaging.store.draft(d.id).status).toBe('sending');
    expect(engine.messaging.snapshot().metrics.confirmedSimulatedSends).toBe(0);
    mock.receipt(mock.sends[0].id);
    mock.receipt(mock.sends[0].id);
    expect(engine.messaging.store.draft(d.id).status).toBe('sent');
    expect(
      engine.messaging.store.audits(d.conversationId).filter((e) => e.action === 'send_confirmed'),
    ).toHaveLength(1);
  });
  it('requires the official offer, interest and explicit acceptance before Sophia invitation', () => {
    const c = conversation();
    company(c);
    expect(() => engine.messaging.draft(c.id, 'Convite', 'invitation')).toThrow(/URL/);
    knowledge();
    expect(() =>
      engine.messaging.draft(c.id, 'https://cadastro.example.org/', 'invitation'),
    ).toThrow(/aceitação/);
    const msg = engine.messaging.store.latestInbound(c.id);
    engine.messaging.acceptance(c.id, msg.id, 'interest', 'Cliente demonstrou interesse (fixture)');
    engine.messaging.acceptance(
      c.id,
      msg.id,
      'link_acceptance',
      'Cliente aceitou receber link (fixture)',
    );
    expect(() =>
      engine.messaging.draft(c.id, 'Convite https://outro.example.org/', 'invitation'),
    ).toThrow(/URL/);
    expect(
      engine.messaging.draft(c.id, 'Teste 7 dias: https://cadastro.example.org/', 'invitation')
        .kind,
    ).toBe('invitation');
  });
  it('hands confirmed invitations to the CEO and blocks late agent replies', async () => {
    const c = conversation();
    company(c);
    knowledge();
    const msg = engine.messaging.store.latestInbound(c.id);
    engine.messaging.acceptance(c.id, msg.id, 'interest', 'Interesse TESTE');
    engine.messaging.acceptance(c.id, msg.id, 'link_acceptance', 'Aceitação TESTE');
    const d = engine.messaging.draft(
      c.id,
      'Experimenta 7 dias: https://cadastro.example.org/',
      'invitation',
    );
    engine.messaging.review(d.id, 'approved');
    await engine.messaging.send(d.id);
    expect(engine.messaging.store.conversation(c.id)).toMatchObject({
      owner: 'ceo',
      state: 'human',
    });
    expect(() => engine.queueMessagingWork(c.id, 'luna', false)).toThrow(/bloquead/);
    expect(engine.crm.company(engine.messaging.store.conversation(c.id).companyId!).stage).not.toBe(
      'ceo',
    );
  });
  it('honours opt-out and detected human intervention without granting permissions from input', () => {
    const c = conversation();
    const id = company(c);
    mock.receive('stop-event', remote, 'Não quero mensagens');
    expect(engine.messaging.store.conversation(c.id).state).toBe('opted_out');
    expect(engine.crm.eligibility(id, 'whatsapp').allowed).toBe(false);
    expect(() => engine.messaging.draft(c.id, 'Mais publicidade')).toThrow(/não contacto/);
  });
  it('assigns detectable human messages to CEO, cancelling queued agent participation', () => {
    const c = conversation();
    company(c);
    const task = engine.queueMessagingWork(c.id, 'luna', false);
    mock.human('human-1', remote, 'Sou o CEO, assumo a conversa');
    expect(engine.messaging.store.conversation(c.id).owner).toBe('ceo');
    expect(engine.getTask(task.id).status).toBe('cancelled');
  });
  it('blocks automatic mode for every current provider and does not auto-send in manual mode', () => {
    expect(() => engine.messaging.setMode('automatic')).toThrow(/bloqueado/);
    engine.messaging.setMode('manual');
    conversation();
    expect(engine.snapshot().tasks).toHaveLength(0);
    expect(mock.sends).toHaveLength(0);
  });
  it('runs eight employees as real dependent backend tasks without inference or sends', async () => {
    const c = conversation();
    company(c);
    knowledge();
    const working = new Set<string>();
    engine.on('changed', () => {
      for (const e of engine.snapshot().employees) if (e.status === 'working') working.add(e.id);
    });
    const tasks = engine.queueMessagingTeam(c.id, false);
    await until(() =>
      tasks.every((t) => ['completed', 'error', 'cancelled'].includes(engine.getTask(t.id).status)),
    );
    expect(tasks.every((t) => engine.getTask(t.id).status === 'completed')).toBe(true);
    expect(working.size).toBe(8);
    expect(engine.messaging.store.detail(c.id).drafts.map((d) => d.employeeId)).toContain('victor');
    expect(mock.sends).toHaveLength(0);
  });
  it('cancels eligible queued work on channel suspension without destroying history', () => {
    const c = conversation();
    const tasks = engine.queueMessagingTeam(c.id, false);
    engine.messaging.suspend(true);
    expect(tasks.every((t) => engine.getTask(t.id).status === 'cancelled')).toBe(true);
    expect(engine.messaging.store.detail(c.id).messages).toHaveLength(1);
  });
  it('unlocks a reconciled reply into human control and preserves the confirmed send', async () => {
    const d = approved();
    mock.outcome = 'ambiguous';
    await engine.messaging.send(d.id);
    const delivery = engine.messaging.deliveries(d.conversationId)[0] as { id: string };
    engine.messaging.reconcile(
      delivery.id,
      'confirmed',
      'TESTE: envio verificado de forma independente',
    );
    expect(engine.messaging.store.conversation(d.conversationId)).toMatchObject({
      owner: 'ceo',
      state: 'human',
    });
    expect(engine.messaging.store.draft(d.id).status).toBe('sent');
    expect(mock.sends).toHaveLength(1);
  });
  it('restores inbox IDs and marks pending deliveries uncertain after restart', async () => {
    const c = conversation();
    const d = approved(c);
    mock.outcome = 'pending';
    await engine.messaging.send(d.id);
    engine.close();
    mock = new MockWhatsAppProvider();
    engine = new SalesEngine(root, undefined, mock);
    expect(engine.messaging.store.conversation(c.id).id).toBe(c.id);
    expect(engine.messaging.store.draft(d.id).status).toBe('reconciliation');
    expect(engine.messaging.snapshot().connection.status).toBe('disconnected');
    expect(engine.messaging.store.detail(c.id).messages).toHaveLength(2);
  });
  it('migrates schema v3 to the current schema without changing earlier data or identifiers', () => {
    engine.close();
    let db = new DatabaseSync(path.join(root, 'sales.sqlite'));
    db.exec('PRAGMA foreign_keys=OFF');
    for (const row of db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'messaging_%'")
      .all())
      db.exec(`DROP TABLE "${row.name}"`);
    db.exec('PRAGMA user_version=3');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => String(r.name));
    const fingerprint = () =>
      createHash('sha256')
        .update(
          JSON.stringify(
            tables.map((t) => db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()),
          ),
        )
        .digest('hex');
    const before = fingerprint();
    db.close();
    engine = new SalesEngine(root);
    engine.close();
    db = new DatabaseSync(path.join(root, 'sales.sqlite'));
    expect(fingerprint()).toBe(before);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
    db.close();
    engine = new SalesEngine(root);
  });
});
