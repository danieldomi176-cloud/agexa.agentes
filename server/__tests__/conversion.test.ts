/** Fictional business fixtures in temporary SQLite databases; never an actual conversion. */
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversionFact, ConversionKind } from '../../core/src/conversion.js';
import { SalesEngine } from '../src/agexa/engine.js';
import { MockWhatsAppProvider } from '../src/agexa/messaging/mock.js';
let root: string, engine: SalesEngine, mock: MockWhatsAppProvider;
const time = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const fact = (kind: ConversionKind, extra: Partial<ConversionFact> = {}): ConversionFact => ({
  eventId: randomUUID(),
  appId: 'manual-agexa',
  kind,
  occurredAt: time(-0.01),
  accountId: 'fixture-account-1',
  evidence: 'TESTE: confirmação independente fictícia',
  ...extra,
});
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'conversion-unit-'));
  mock = new MockWhatsAppProvider();
  engine = new SalesEngine(root, undefined, mock);
});
afterEach(() => {
  engine.close();
  fs.rmSync(root, { recursive: true, force: true });
});
function company(mode: 'provided' | 'simulated' = 'provided', name = 'EMPRESA FICTÍCIA') {
  const source = engine.crm.createSource({
    name: 'Fonte TESTE',
    kind: 'manual',
    url: null,
    termsUrl: null,
    permissionEvidence: 'Teste autorizado',
    attribution: 'TESTE',
    enabled: true,
    termsReviewed: true,
    commercialReuseAllowed: true,
  });
  return engine.crm.importCompanies(
    [
      {
        name,
        sector: 'barbearia',
        city: 'Beira',
        country: 'Moçambique',
        contactChannel: 'whatsapp',
        businessContact: '258840000001',
      },
    ],
    source.id,
    'fixture',
    mode,
  ).companyIds[0];
}
function register(id: string) {
  return engine.conversion.manual(id, fact('account_created', { occurredAt: time(-10) }));
}
async function invitation() {
  const id = company('simulated');
  await engine.messaging.configure('mock');
  await engine.messaging.connect();
  await Promise.resolve();
  engine.messaging.suspend(false);
  mock.receive(
    'inbound-reference',
    '258840000001@c.us',
    'Tenho interesse e aceito receber o link.',
  );
  const c = engine.messaging.store.list('mock').items[0];
  engine.messaging.link(c.id, id);
  engine.crm.consent(id, 'whatsapp', 'granted', 'Opt-in TESTE', 'Fixture');
  engine.saveKnowledge({
    signupUrl: 'https://cadastro.example.org/',
    trialAvailable: true,
    trialDays: 7,
    confirmedFeatures: [],
    approvedPrices: [],
    policies: [],
  });
  const m = engine.messaging.store.latestInbound(c.id);
  engine.messaging.acceptance(c.id, m.id, 'interest', 'TESTE');
  engine.messaging.acceptance(c.id, m.id, 'link_acceptance', 'TESTE');
  return { id, c };
}
describe('Conversion ledger and manual fallback — fixtures only', () => {
  it('records audited manual registration without labeling it API verification', () => {
    const id = company();
    register(id);
    expect(engine.crm.company(id).stage).toBe('account');
    expect(engine.conversion.snapshot().metrics.origins.manual.accounts).toBe(1);
    expect(engine.conversion.snapshot().metrics.origins.integration.accounts).toBe(0);
    expect(engine.conversion.snapshot().trials).toHaveLength(0);
  });
  it('deduplicates registration by event ID and preserves the original record', () => {
    const id = company();
    const f = fact('account_created');
    const first = engine.conversion.manual(id, f);
    expect(engine.conversion.manual(id, f)).toMatchObject({ id: first.id, duplicate: true });
    expect(engine.conversion.snapshot().accounts).toHaveLength(1);
    expect(engine.conversion.store.events().total).toBe(1);
  });
  it('refuses conflicting payloads for the same event ID', () => {
    const id = company();
    const f = fact('account_created');
    engine.conversion.manual(id, f);
    expect(() => engine.conversion.manual(id, { ...f, evidence: 'Modified' })).toThrow(
      /conteúdo diferente/,
    );
    expect(engine.conversion.store.events().items[0].payload?.evidence).toBe(f.evidence);
  });
  it('does not infer attribution from names or unknown references', () => {
    company('provided', 'Mesma empresa');
    const result = engine.conversion.store.ingest(
      fact('account_created', { reference: 'unknown-reference' }),
      'integration',
    );
    expect(engine.conversion.store.events().items[0]).toMatchObject({
      id: result.id,
      status: 'pending',
      companyId: null,
    });
    expect(engine.conversion.snapshot().accounts).toHaveLength(0);
  });
  it('keeps all simulated accounts, trials and receipts out of real funnel metrics', () => {
    const id = company('simulated');
    register(id);
    engine.conversion.manual(id, fact('trial_started', { startAt: time(-1), endAt: time(6) }));
    engine.conversion.manual(
      id,
      fact('payment_confirmed', {
        verified: true,
        paymentId: 'fixture-receipt',
        amountMinor: 1000,
        currency: 'MZN',
      }),
    );
    const m = engine.conversion.snapshot().metrics;
    expect(m.origins.simulated.paying).toBe(1);
    expect(m.origins.manual.paying).toBe(0);
    expect(m.funnel.find((f) => f.key === 'paying')?.count).toBe(0);
    expect(engine.crm.company(id).stage).toBe('identified');
  });
  it('retains out-of-order payment until registration arrives, then applies it once', () => {
    const id = company();
    engine.conversion.manual(
      id,
      fact('payment_confirmed', {
        verified: true,
        paymentId: 'fixture-receipt',
        amountMinor: 2300,
        currency: 'MZN',
      }),
    );
    expect(engine.conversion.store.events('pending').total).toBe(1);
    register(id);
    expect(engine.conversion.store.events('pending').total).toBe(0);
    expect(engine.crm.company(id).stage).toBe('paying');
    expect(engine.conversion.snapshot().metrics.origins.manual.revenue.MZN).toBe(2300);
  });
  it.each([
    { verified: false, amountMinor: 100 },
    { verified: true, amountMinor: 0 },
    { verified: true, amountMinor: -1 },
  ])('rejects payment without positive amount and independent confirmation: %j', (extra) => {
    const id = company();
    register(id);
    expect(() =>
      engine.conversion.manual(
        id,
        fact('payment_confirmed', { paymentId: 'bad-payment', currency: 'MZN', ...extra }),
      ),
    ).toThrow(/Pagamento/);
    expect(engine.crm.company(id).stage).toBe('account');
  });
  it('deduplicates a payment receipt even if an upstream event is reissued under another ID', () => {
    const id = company();
    register(id);
    const p = fact('payment_confirmed', {
      verified: true,
      paymentId: 'same-receipt',
      amountMinor: 1000,
      currency: 'MZN',
    });
    engine.conversion.manual(id, p);
    engine.conversion.manual(id, { ...p, eventId: randomUUID() });
    expect(engine.conversion.snapshot().metrics.origins.manual.revenue.MZN).toBe(1000);
  });
  it('tracks actual seven-day dates and only confirms expiry from an explicit fact', () => {
    const id = company();
    register(id);
    const start = time(-8),
      end = new Date(Date.parse(start) + 7 * 86400000).toISOString();
    engine.conversion.manual(
      id,
      fact('trial_started', { occurredAt: time(-8), startAt: start, endAt: end }),
    );
    let t = engine.conversion.snapshot().trials[0];
    expect(t.actualDurationDays).toBe(7);
    expect(t.effectiveState).toBe('end_due_awaiting_confirmation');
    expect(engine.conversion.snapshot().metrics.origins.manual.expiredTrials).toBe(0);
    engine.conversion.manual(id, fact('trial_ended'));
    t = engine.conversion.snapshot().trials[0];
    expect(t.status).toBe('expired');
    expect(engine.crm.company(id).stage).toBe('trial_ended');
  });
  it('supports explicit extensions/cancellations without deriving dates from invitation timestamps', () => {
    const id = company();
    register(id);
    const start = time(-5);
    engine.conversion.manual(
      id,
      fact('trial_started', { occurredAt: time(-5), startAt: start, endAt: time(2) }),
    );
    engine.conversion.manual(
      id,
      fact('trial_extended', { occurredAt: time(-2), startAt: start, endAt: time(5) }),
    );
    expect(engine.conversion.snapshot().trials[0].actualDurationDays).toBeCloseTo(10, 3);
    engine.conversion.manual(id, fact('trial_cancelled'));
    expect(engine.conversion.snapshot().trials[0].status).toBe('cancelled');
  });
  it('does not downgrade a paying client when a later trial-end event arrives', () => {
    const id = company();
    register(id);
    engine.conversion.manual(
      id,
      fact('trial_started', { occurredAt: time(-2), startAt: time(-2), endAt: time(5) }),
    );
    engine.conversion.manual(
      id,
      fact('payment_confirmed', {
        occurredAt: time(-1),
        verified: true,
        paymentId: 'receipt',
        amountMinor: 100,
        currency: 'MZN',
      }),
    );
    engine.conversion.manual(id, fact('trial_ended'));
    expect(engine.conversion.snapshot().trials[0].status).toBe('converted');
    expect(engine.crm.company(id).stage).toBe('paying');
    engine.crm.recordMessagingHandoff(id, 'Subsequent confirmed invitation fixture');
    expect(engine.crm.company(id).stage).toBe('paying');
  });
  it('ignores an older lifecycle event after a newer confirmed state', () => {
    const id = company();
    register(id);
    engine.conversion.manual(
      id,
      fact('trial_started', { occurredAt: time(-5), startAt: time(-5), endAt: time(2) }),
    );
    engine.conversion.manual(id, fact('trial_cancelled', { occurredAt: time(-1) }));
    engine.conversion.manual(
      id,
      fact('trial_extended', { occurredAt: time(-3), startAt: time(-5), endAt: time(9) }),
    );
    expect(engine.conversion.snapshot().trials[0].status).toBe('cancelled');
  });
  it('rejects ambiguous account/company attribution and permits a separately audited alias', () => {
    const one = company(),
      two = company('provided', 'OUTRA EMPRESA FICTÍCIA');
    register(one);
    const mismatch = engine.conversion.manual(
      two,
      fact('trial_started', { startAt: time(-1), endAt: time(6) }),
    );
    expect(engine.conversion.store.events('pending').items.some((e) => e.id === mismatch.id)).toBe(
      true,
    );
    const alias = engine.conversion.manual(
      one,
      fact('account_created', { accountId: 'replacement-id' }),
    );
    expect(engine.conversion.store.events('pending').items.some((e) => e.id === alias.id)).toBe(
      true,
    );
    engine.conversion.resolve(alias.id, one, 'TESTE: identidade externa confirmada', true);
    expect(engine.conversion.store.account('manual-agexa', 'replacement-id')?.companyId).toBe(one);
    expect(engine.conversion.snapshot().accounts).toHaveLength(1);
  });
  it('rejects future timestamps and arbitrary payment/configuration fields in external data', () => {
    const id = company();
    expect(() =>
      engine.conversion.manual(id, fact('account_created', { occurredAt: time(1) })),
    ).toThrow(/futura/);
    expect(() =>
      engine.conversion.store.ingest({ ...fact('account_created'), admin: true }, 'integration'),
    ).toThrow(/Contrato/);
  });
  it('keeps idempotency tombstones after payload retention', () => {
    const id = company();
    const f = fact('account_created');
    const r = engine.conversion.manual(id, f);
    engine.conversion.store.db
      .prepare('UPDATE conversion_events SET receivedAt=? WHERE id=?')
      .run(time(-400), r.id);
    expect(engine.conversion.store.prune()).toBe(1);
    expect(engine.conversion.store.events().items[0].payload).toBeNull();
    expect(engine.conversion.manual(id, f).duplicate).toBe(true);
    expect(engine.conversion.snapshot().accounts).toHaveLength(1);
  });
  it('persists notifications and ledger IDs across restart', () => {
    const id = company();
    const event = register(id);
    const notice = engine.conversion.snapshot().notices[0].id;
    engine.close();
    engine = new SalesEngine(root);
    expect(engine.conversion.store.events().items[0].id).toBe(event.id);
    expect(engine.conversion.snapshot().notices[0].id).toBe(notice);
  });
  it('adds schema v5 without changing any v4 record or identifier', () => {
    const id = company();
    engine.crm.consent(id, 'whatsapp', 'granted', 'Fixture', 'Fixture');
    engine.close();
    let db = new DatabaseSync(path.join(root, 'sales.sqlite'));
    db.exec('PRAGMA foreign_keys=OFF');
    for (const row of db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'conversion_%'")
      .all())
      db.exec(`DROP TABLE "${row.name}"`);
    db.exec('PRAGMA user_version=4');
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => String(r.name));
    const digest = () =>
      createHash('sha256')
        .update(
          JSON.stringify(
            tables.map((t) => db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()),
          ),
        )
        .digest('hex');
    const before = digest();
    db.close();
    engine = new SalesEngine(root);
    engine.close();
    db = new DatabaseSync(path.join(root, 'sales.sqlite'));
    expect(digest()).toBe(before);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
    db.close();
    engine = new SalesEngine(root);
  });
  it('keeps unsupported legacy confirmations separate instead of inventing trial dates or revenue', () => {
    const id = company();
    engine.moveCrm(id, 'account', {
      independentlyVerified: true,
      evidence: 'Fixture legacy account',
      occurredAt: time(-1),
    });
    engine.moveCrm(id, 'paying', {
      independentlyVerified: true,
      evidence: 'Fixture legacy payment',
      occurredAt: time(-1),
    });
    expect(engine.conversion.snapshot().metrics.legacyManual).toMatchObject({
      accounts: 1,
      payingWithoutAmount: 1,
    });
    expect(engine.conversion.snapshot().trials).toHaveLength(0);
    expect(engine.conversion.snapshot().metrics.origins.manual.revenue).toEqual({});
  });
  it('records lack of real inference independently without fabricating a model result', () => {
    expect(() => engine.validateInference()).toThrow(/indisponível/);
    expect(engine.conversion.snapshot().validations[0]).toMatchObject({
      mode: 'unavailable',
      status: 'unavailable',
      taskId: null,
    });
  });
  it('preserves the existing handoff and adds persistent CEO context from confirmed mock messages', async () => {
    const { id, c } = await invitation();
    const d = engine.messaging.draft(
      c.id,
      'Convite 7 dias: https://cadastro.example.org/',
      'invitation',
    );
    expect(engine.conversion.snapshot().invites).toHaveLength(1);
    engine.messaging.review(d.id, 'approved');
    await engine.messaging.send(d.id);
    const s = engine.conversion.snapshot();
    expect(s.followups).toHaveLength(1);
    expect(s.notices.some((n) => n.kind === 'ceo_handoff')).toBe(true);
    expect(engine.messaging.store.conversation(c.id)).toMatchObject({
      owner: 'ceo',
      state: 'human',
    });
    expect(() => engine.queueMessagingWork(c.id, 'luna', false)).toThrow();
    const summary = engine.conversion.handoffDetail(s.followups[0].id);
    expect(summary.company).toMatchObject({ id });
    expect(summary.observedObjections).toEqual([]);
    engine.conversion.invitationConfirmed(
      d.id,
      (engine.messaging.deliveries(c.id)[0] as { id: string }).id,
    );
    expect(engine.conversion.snapshot().followups).toHaveLength(1);
  });
  it('adds opaque tracking only after the app capability is explicitly confirmed', async () => {
    const { c } = await invitation();
    let d = engine.messaging.draft(c.id, 'https://cadastro.example.org/', 'invitation');
    expect(d.body).toBe('https://cadastro.example.org/');
    engine.conversion.configure({
      ...engine.conversion.store.config(),
      appId: 'app-fixture',
      referenceSupported: true,
      permissionEvidence: 'TESTE: app supports reference capture',
    });
    d = engine.messaging.draft(c.id, 'https://cadastro.example.org/', 'invitation');
    expect(d.body).toMatch(/agexa_ref=[a-f0-9-]{36}/);
    expect(d.body).not.toContain('258840000001');
    expect(() =>
      engine.messaging.draft(c.id, 'https://cadastro.example.org/?agexa_ref=forged', 'invitation'),
    ).toThrow(/URL/);
  });
  it('does not infer signup from link preparation, sending or interest', async () => {
    const { c } = await invitation();
    const d = engine.messaging.draft(c.id, 'https://cadastro.example.org/', 'invitation');
    engine.messaging.review(d.id, 'approved');
    await engine.messaging.send(d.id);
    expect(engine.conversion.snapshot().accounts).toHaveLength(0);
    expect(engine.conversion.snapshot().trials).toHaveLength(0);
    expect(engine.conversion.snapshot().metrics.origins.simulated.paying).toBe(0);
  });
  it.each(['provider', 'manual'] as const)(
    'keeps the %s confirmation proof separate from other reconciliations',
    async (proof) => {
      const { c } = await invitation();
      const observed = vi.spyOn(engine.conversion, 'invitationConfirmed');
      const d = engine.messaging.draft(c.id, 'https://cadastro.example.org/', 'invitation');
      engine.messaging.review(d.id, 'approved');
      if (proof === 'manual') mock.outcome = 'pending';
      await engine.messaging.send(d.id);
      const delivery = engine.messaging.deliveries(c.id)[0] as { id: string };
      if (proof === 'manual')
        engine.messaging.reconcile(delivery.id, 'confirmed', 'Independent fixture confirmation');
      expect(observed).toHaveBeenCalledWith(d.id, delivery.id, proof);
    },
  );
  it('deduplicates the same receipt after audited account aliasing from manual to app integration', () => {
    const id = company();
    register(id);
    engine.conversion.manual(
      id,
      fact('payment_confirmed', {
        verified: true,
        paymentId: 'same-financial-receipt',
        amountMinor: 1000,
        currency: 'MZN',
      }),
    );
    const r = engine.conversion.store.ingest(
      fact('account_created', { appId: 'new-app', accountId: 'confirmed-account-alias' }),
      'integration',
      id,
    );
    engine.conversion.resolve(r.id, id, 'Independent account identity confirmation', true);
    engine.conversion.store.ingest(
      fact('payment_confirmed', {
        appId: 'new-app',
        accountId: 'confirmed-account-alias',
        verified: true,
        paymentId: 'same-financial-receipt',
        amountMinor: 1000,
        currency: 'MZN',
      }),
      'integration',
    );
    const metrics = engine.conversion.snapshot().metrics;
    expect(
      (metrics.origins.manual.revenue.MZN ?? 0) + (metrics.origins.integration.revenue.MZN ?? 0),
    ).toBe(1000);
  });
});
