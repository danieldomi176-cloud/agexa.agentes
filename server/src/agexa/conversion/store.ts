import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  ConfirmationOrigin,
  ConversionAccount,
  ConversionConfig,
  ConversionEvent,
  ConversionFact,
  ConversionInvite,
  ConversionMetrics,
  ConversionNotice,
  TrialRecord,
} from '../../../../core/src/conversion.js';
import { CrmError } from '../crm/error.js';
import type { CrmStore } from '../crm/store.js';
import { isoDate, validateFact } from './contract.js';
const now = () => new Date().toISOString();
export const DEFAULT_CONVERSION: ConversionConfig = {
  appId: '',
  endpoint: null,
  syncMode: 'manual',
  authType: 'hmac-sha256',
  referenceSupported: false,
  referenceParameter: 'agexa_ref',
  permissionEvidence: '',
  retentionDays: 365,
};
export class ConversionStore {
  private seq = 0;
  constructor(
    readonly db: DatabaseSync,
    readonly crm: CrmStore,
  ) {
    db.exec(`SAVEPOINT conversion_migration;
 CREATE TABLE IF NOT EXISTS conversion_config(id TEXT PRIMARY KEY,value TEXT NOT NULL,cursor TEXT,lastSync TEXT,error TEXT,status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversion_references(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES crm_companies(id),conversationId TEXT NOT NULL REFERENCES messaging_conversations(id),officialUrl TEXT NOT NULL,trackedUrl TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversion_invites(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES crm_companies(id),conversationId TEXT NOT NULL REFERENCES messaging_conversations(id),draftId TEXT NOT NULL UNIQUE REFERENCES messaging_drafts(id),reference TEXT NOT NULL REFERENCES conversion_references(id),employeeId TEXT NOT NULL,preparedAt TEXT NOT NULL,confirmedAt TEXT,officialUrl TEXT NOT NULL,sentUrl TEXT NOT NULL,simulated INTEGER NOT NULL,confirmationOrigin TEXT);
 CREATE TABLE IF NOT EXISTS conversion_events(id TEXT PRIMARY KEY,appId TEXT NOT NULL,externalId TEXT NOT NULL,companyId TEXT REFERENCES crm_companies(id),kind TEXT NOT NULL,occurredAt TEXT NOT NULL,origin TEXT NOT NULL,status TEXT NOT NULL,reason TEXT,payload TEXT,digest TEXT NOT NULL,receivedAt TEXT NOT NULL,attribution TEXT NOT NULL,UNIQUE(appId,externalId));
 CREATE TABLE IF NOT EXISTS conversion_accounts(id TEXT PRIMARY KEY,companyId TEXT NOT NULL UNIQUE REFERENCES crm_companies(id),appId TEXT NOT NULL,externalId TEXT NOT NULL,origin TEXT NOT NULL,createdAt TEXT NOT NULL,attribution TEXT NOT NULL,UNIQUE(appId,externalId));
 CREATE TABLE IF NOT EXISTS conversion_account_aliases(appId TEXT NOT NULL,externalId TEXT NOT NULL,accountId TEXT NOT NULL REFERENCES conversion_accounts(id),evidence TEXT NOT NULL,createdAt TEXT NOT NULL,PRIMARY KEY(appId,externalId));
 CREATE TABLE IF NOT EXISTS conversion_trials(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES crm_companies(id),accountId TEXT NOT NULL UNIQUE REFERENCES conversion_accounts(id),startAt TEXT NOT NULL,endAt TEXT NOT NULL,status TEXT NOT NULL,updatedAt TEXT NOT NULL,origin TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversion_payments(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES crm_companies(id),accountId TEXT NOT NULL REFERENCES conversion_accounts(id),appId TEXT NOT NULL,externalId TEXT NOT NULL,amountMinor INTEGER NOT NULL,currency TEXT NOT NULL,origin TEXT NOT NULL,occurredAt TEXT NOT NULL,UNIQUE(appId,externalId));
 CREATE TABLE IF NOT EXISTS conversion_followups(id TEXT PRIMARY KEY,inviteId TEXT NOT NULL UNIQUE REFERENCES conversion_invites(id),companyId TEXT NOT NULL REFERENCES crm_companies(id),conversationId TEXT NOT NULL REFERENCES messaging_conversations(id),notes TEXT NOT NULL DEFAULT '',followupAt TEXT,closedReason TEXT,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversion_notices(id TEXT PRIMARY KEY,sourceKey TEXT NOT NULL UNIQUE,companyId TEXT NOT NULL REFERENCES crm_companies(id),conversationId TEXT,kind TEXT NOT NULL,body TEXT NOT NULL,createdAt TEXT NOT NULL,seenAt TEXT);
 CREATE TABLE IF NOT EXISTS conversion_objections(messageId TEXT PRIMARY KEY REFERENCES messaging_messages(id),conversationId TEXT NOT NULL REFERENCES messaging_conversations(id),evidence TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversion_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,companyId TEXT,action TEXT NOT NULL,detail TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversion_sync_runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,startedAt TEXT NOT NULL,finishedAt TEXT,error TEXT,nonce TEXT UNIQUE);
 CREATE TABLE IF NOT EXISTS conversion_validations(id TEXT PRIMARY KEY,taskId TEXT UNIQUE,mode TEXT NOT NULL,status TEXT NOT NULL,model TEXT,durationMs INTEGER,createdAt TEXT NOT NULL,detail TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS conversion_payment_account_receipt ON conversion_payments(accountId,externalId);
 CREATE INDEX IF NOT EXISTS conversion_pending ON conversion_events(status,occurredAt);
 PRAGMA user_version=5; RELEASE conversion_migration;`);
    this.db
      .prepare(
        "UPDATE conversion_sync_runs SET status='interrupted',finishedAt=?,error='Reinício durante sincronização; não repetir ações externas; nova leitura exige ação do CEO.' WHERE status='running'",
      )
      .run(now());
  }
  atomic<T>(fn: () => T): T {
    const id = `conv_${++this.seq}`;
    this.db.exec(`SAVEPOINT ${id}`);
    try {
      const r = fn();
      this.db.exec(`RELEASE ${id}`);
      return r;
    } catch (e) {
      this.db.exec(`ROLLBACK TO ${id}; RELEASE ${id}`);
      throw e;
    }
  }
  audit(action: string, detail: string, companyId: string | null = null): void {
    this.db
      .prepare('INSERT INTO conversion_audit(companyId,action,detail,createdAt) VALUES (?,?,?,?)')
      .run(companyId, action, detail.slice(0, 2000), now());
  }
  config(): ConversionConfig {
    const r = this.db.prepare("SELECT value FROM conversion_config WHERE id='main'").get();
    return r ? JSON.parse(String(r.value)) : { ...DEFAULT_CONVERSION };
  }
  integration(): {
    cursor: string | null;
    lastSync: string | null;
    error: string | null;
    status: string;
  } {
    const r = this.db
      .prepare("SELECT cursor,lastSync,error,status FROM conversion_config WHERE id='main'")
      .get();
    return (
      (r as unknown as ReturnType<ConversionStore['integration']>) ?? {
        cursor: null,
        lastSync: null,
        error: null,
        status: 'manual_only',
      }
    );
  }
  saveConfig(c: ConversionConfig): void {
    this.db
      .prepare(
        "INSERT INTO conversion_config(id,value,status) VALUES ('main',?,'configured_unvalidated') ON CONFLICT(id) DO UPDATE SET value=excluded.value,cursor=NULL,error=NULL,status='configured_unvalidated'",
      )
      .run(JSON.stringify(c));
    this.audit('integration_configured', 'Configuração alterada; sem validação real implícita.');
  }
  notice(
    sourceKey: string,
    companyId: string,
    kind: string,
    body: string,
    conversationId: string | null = null,
  ): void {
    this.db
      .prepare('INSERT OR IGNORE INTO conversion_notices VALUES (?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        sourceKey,
        companyId,
        conversationId,
        kind,
        body.slice(0, 1000),
        now(),
        null,
      );
  }
  notices(): ConversionNotice[] {
    return this.db
      .prepare(
        'SELECT id,companyId,conversationId,kind,body,createdAt,seenAt FROM conversion_notices ORDER BY rowid DESC LIMIT 100',
      )
      .all() as unknown as ConversionNotice[];
  }
  invites(): ConversionInvite[] {
    return this.db
      .prepare('SELECT * FROM conversion_invites ORDER BY rowid DESC LIMIT 100')
      .all()
      .map((r) => ({ ...r, simulated: !!r.simulated })) as unknown as ConversionInvite[];
  }
  events(status = '', page = 1): { items: ConversionEvent[]; total: number; page: number } {
    const where = status ? ' WHERE status=?' : '';
    const args = status ? [status] : [];
    return {
      items: this.db
        .prepare(`SELECT * FROM conversion_events${where} ORDER BY rowid DESC LIMIT 50 OFFSET ?`)
        .all(...args, (page - 1) * 50)
        .map((r) => ({
          ...r,
          payload: r.payload ? JSON.parse(String(r.payload)) : null,
        })) as unknown as ConversionEvent[],
      total: Number(
        this.db.prepare(`SELECT count(*) n FROM conversion_events${where}`).get(...args)?.n,
      ),
      page,
    };
  }
  account(appId: string, externalId: string): ConversionAccount | null {
    const r = this.db
      .prepare(
        'SELECT a.* FROM conversion_accounts a LEFT JOIN conversion_account_aliases x ON x.accountId=a.id WHERE (a.appId=? AND a.externalId=?) OR (x.appId=? AND x.externalId=?) LIMIT 1',
      )
      .get(appId, externalId, appId, externalId);
    return (r as unknown as ConversionAccount) ?? null;
  }
  ingest(
    input: unknown,
    source: 'integration' | 'manual' | 'simulated',
    companyId?: string,
  ): { id: string; duplicate: boolean } {
    const fact = validateFact(input);
    const digest = createHash('sha256')
      .update(
        JSON.stringify(
          Object.fromEntries(
            Object.keys(fact)
              .sort()
              .map((k) => [k, fact[k as keyof ConversionFact]]),
          ),
        ),
      )
      .digest('hex');
    const previous = this.db
      .prepare('SELECT id,digest FROM conversion_events WHERE appId=? AND externalId=?')
      .get(fact.appId, fact.eventId);
    if (previous) {
      if (previous.digest !== digest) {
        this.audit('event_id_conflict', 'ID repetido com conteúdo diferente; original preservado.');
        throw new CrmError('Evento repetido com conteúdo diferente; reconciliar na origem');
      }
      return { id: String(previous.id), duplicate: true };
    }
    const ref = fact.reference
      ? this.db
          .prepare('SELECT companyId FROM conversion_references WHERE id=?')
          .get(fact.reference)
      : null;
    const account = this.account(fact.appId, fact.accountId);
    const target = companyId ?? (ref ? String(ref.companyId) : account?.companyId);
    const attribution = companyId
      ? 'ceo'
      : ref
        ? 'exact_reference'
        : account
          ? 'existing_account'
          : 'unresolved';
    let origin: ConfirmationOrigin = source;
    if (target) {
      const company = this.crm.company(target);
      if (company.recordMode === 'simulated') origin = 'simulated';
      else if (source === 'simulated')
        throw new CrmError('Evento simulado não pode atualizar empresa real');
    }
    return this.atomic(() => {
      const id = randomUUID();
      this.db
        .prepare('INSERT INTO conversion_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          fact.appId,
          fact.eventId,
          target ?? null,
          fact.kind,
          fact.occurredAt,
          origin,
          'pending',
          null,
          JSON.stringify(fact),
          digest,
          now(),
          attribution,
        );
      this.apply(id);
      this.reconcilePending();
      return { id, duplicate: false };
    });
  }
  private pending(id: string, reason: string): void {
    this.db.prepare('UPDATE conversion_events SET reason=? WHERE id=?').run(reason, id);
  }
  private apply(id: string): void {
    const row = this.db.prepare('SELECT * FROM conversion_events WHERE id=?').get(id);
    if (!row || row.status !== 'pending' || !row.payload) return;
    const f = JSON.parse(String(row.payload)) as ConversionFact;
    let companyId = row.companyId ? String(row.companyId) : null;
    const account = this.account(f.appId, f.accountId);
    const reference = f.reference
      ? this.db.prepare('SELECT companyId FROM conversion_references WHERE id=?').get(f.reference)
      : null;
    if (!companyId)
      companyId = reference ? String(reference.companyId) : (account?.companyId ?? null);
    if (!companyId) {
      this.pending(
        id,
        'Atribuição desconhecida; sem correspondência por nomes. CEO deve associar com evidência.',
      );
      return;
    }
    if (
      (account && account.companyId !== companyId) ||
      (reference && reference.companyId !== companyId)
    ) {
      this.pending(id, 'Atribuição ambígua: referência/conta/empresa em conflito.');
      return;
    }
    const company = this.crm.company(companyId);
    if (row.origin === 'simulated' && company.recordMode !== 'simulated') {
      this.pending(id, 'Simulação não pode confirmar empresa real.');
      return;
    }
    const origin: ConfirmationOrigin =
      company.recordMode === 'simulated' ? 'simulated' : (row.origin as ConfirmationOrigin);
    this.db
      .prepare('UPDATE conversion_events SET companyId=?,origin=? WHERE id=?')
      .run(companyId, origin, id);
    let a = account;
    if (f.kind === 'account_created') {
      const existing = this.db
        .prepare('SELECT * FROM conversion_accounts WHERE companyId=?')
        .get(companyId) as unknown as ConversionAccount | undefined;
      if (existing && !account) {
        this.pending(id, 'Empresa já tem outra conta; confirmar alias com evidência independente.');
        return;
      }
      if (!a) {
        a = {
          id: randomUUID(),
          companyId,
          appId: f.appId,
          externalId: f.accountId,
          origin,
          createdAt: f.occurredAt,
        };
        this.db
          .prepare('INSERT INTO conversion_accounts VALUES (?,?,?,?,?,?,?)')
          .run(
            a.id,
            companyId,
            f.appId,
            f.accountId,
            origin,
            f.occurredAt,
            String(row.attribution),
          );
      }
    } else if (!a) {
      this.pending(id, 'Aguardar confirmação de cadastro antes do teste/pagamento.');
      return;
    }
    if (f.kind.startsWith('trial_')) {
      const trial = this.db.prepare('SELECT * FROM conversion_trials WHERE accountId=?').get(a!.id);
      if (!trial && f.kind !== 'trial_started') {
        this.pending(id, 'Aguardar datas efetivas de início do teste.');
        return;
      }
      if (trial && String(trial.updatedAt) > f.occurredAt) {
        this.pending(id, 'Evento antigo; estado atual preservado.');
        this.db.prepare("UPDATE conversion_events SET status='applied' WHERE id=?").run(id);
        return;
      }
      if (f.kind === 'trial_started' || f.kind === 'trial_extended') {
        const status = this.db
          .prepare('SELECT 1 FROM conversion_payments WHERE accountId=?')
          .get(a!.id)
          ? 'converted'
          : 'active';
        this.db
          .prepare(
            'INSERT INTO conversion_trials VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(accountId) DO UPDATE SET startAt=excluded.startAt,endAt=excluded.endAt,status=excluded.status,updatedAt=excluded.updatedAt,origin=excluded.origin',
          )
          .run(
            trial?.id ?? randomUUID(),
            companyId,
            a!.id,
            isoDate(f.startAt),
            isoDate(f.endAt),
            status,
            f.occurredAt,
            origin,
          );
      } else
        this.db
          .prepare('UPDATE conversion_trials SET status=?,updatedAt=?,origin=? WHERE accountId=?')
          .run(
            this.db.prepare('SELECT 1 FROM conversion_payments WHERE accountId=?').get(a!.id)
              ? 'converted'
              : f.kind === 'trial_ended'
                ? 'expired'
                : 'cancelled',
            f.occurredAt,
            origin,
            a!.id,
          );
    }
    if (f.kind === 'payment_confirmed') {
      const payment = this.db
        .prepare(
          'SELECT * FROM conversion_payments WHERE (appId=? AND externalId=?) OR (accountId=? AND externalId=?)',
        )
        .get(f.appId, f.paymentId!, a!.id, f.paymentId!);
      if (
        payment &&
        (payment.accountId !== a!.id ||
          payment.amountMinor !== f.amountMinor ||
          payment.currency !== f.currency)
      ) {
        this.pending(id, 'Recibo já associado com dados diferentes.');
        return;
      }
      if (!payment)
        this.db
          .prepare('INSERT OR IGNORE INTO conversion_payments VALUES (?,?,?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            companyId,
            a!.id,
            f.appId,
            f.paymentId!,
            f.amountMinor!,
            f.currency!,
            origin,
            f.occurredAt,
          );
      this.db
        .prepare("UPDATE conversion_trials SET status='converted' WHERE accountId=?")
        .run(a!.id);
    }
    this.db.prepare("UPDATE conversion_events SET status='applied',reason=NULL WHERE id=?").run(id);
    if (origin !== 'simulated') {
      const paid = !!this.db
        .prepare('SELECT 1 FROM conversion_payments WHERE companyId=?')
        .get(companyId);
      const trial = this.db
        .prepare('SELECT status FROM conversion_trials WHERE companyId=?')
        .get(companyId);
      const stage = paid
        ? 'paying'
        : trial?.status === 'active'
          ? 'trial'
          : trial?.status === 'expired' || trial?.status === 'cancelled'
            ? 'trial_ended'
            : 'account';
      this.crm.recordConversionFact(
        companyId,
        stage,
        `${origin}: evento ${id}; associação ${row.attribution}; ${f.evidence}`,
      );
    }
    this.notice(
      'event:' + id,
      companyId,
      f.kind,
      `${f.kind}: confirmação ${origin}; associação ${row.attribution}.`,
    );
    this.audit('fact_applied', `${f.kind}; ${origin}; ${row.attribution}`, companyId);
  }
  reconcilePending(): void {
    for (let pass = 0; pass < 3; pass++) {
      const rows = this.db
        .prepare(
          "SELECT id FROM conversion_events WHERE status='pending' ORDER BY occurredAt,rowid LIMIT 100",
        )
        .all();
      for (const r of rows) this.apply(String(r.id));
    }
  }
  resolve(id: string, companyId: string, evidence: string, allowAlias = false): void {
    if (!evidence.trim() || evidence.length > 1000)
      throw new CrmError('Evidência de associação obrigatória');
    const row = this.db.prepare('SELECT * FROM conversion_events WHERE id=?').get(id);
    if (!row || row.status !== 'pending' || !row.payload)
      throw new CrmError('Evento não aguarda associação');
    const f = JSON.parse(String(row.payload)) as ConversionFact;
    const company = this.crm.company(companyId);
    if (row.origin === 'simulated' && company.recordMode !== 'simulated')
      throw new CrmError('Não associar simulação a empresa real');
    this.atomic(() => {
      if (allowAlias) {
        const old = this.db
          .prepare('SELECT id FROM conversion_accounts WHERE companyId=?')
          .get(companyId);
        const known = this.account(f.appId, f.accountId);
        if (!old || (known && known.id !== old.id))
          throw new CrmError('Alias não pode substituir conta de outra empresa');
        this.db
          .prepare('INSERT OR IGNORE INTO conversion_account_aliases VALUES (?,?,?,?,?)')
          .run(f.appId, f.accountId, String(old.id), evidence, now());
      }
      this.db
        .prepare(
          "UPDATE conversion_events SET companyId=?,attribution='ceo',reason=NULL WHERE id=?",
        )
        .run(companyId, id);
      this.audit('attribution_confirmed', evidence, companyId);
      this.apply(id);
      this.reconcilePending();
    });
  }
  trials(): TrialRecord[] {
    return this.db
      .prepare('SELECT * FROM conversion_trials ORDER BY endAt LIMIT 200')
      .all()
      .map((r) => {
        const remaining = Math.max(
          0,
          Math.ceil((Date.parse(String(r.endAt)) - Date.now()) / 86400000),
        );
        return {
          ...r,
          remainingDays: remaining,
          effectiveState:
            r.status === 'active' && Date.parse(String(r.endAt)) < Date.now()
              ? 'end_due_awaiting_confirmation'
              : r.status,
          actualDurationDays:
            (Date.parse(String(r.endAt)) - Date.parse(String(r.startAt))) / 86400000,
        };
      }) as unknown as TrialRecord[];
  }
  alertTrials(): void {
    const due = this.db
      .prepare(
        "SELECT t.* FROM conversion_trials t WHERE t.status='active' AND t.endAt<=? AND NOT EXISTS(SELECT 1 FROM conversion_notices n WHERE n.sourceKey='trial_end:'||t.id||':'||t.endAt) ORDER BY t.endAt LIMIT 200",
      )
      .all(new Date(Date.now() + 2 * 86400000).toISOString());
    for (const t of due) {
      const message =
        Date.parse(String(t.endAt)) < Date.now()
          ? 'Fim previsto atingido; aguardar confirmação real de expiração.'
          : `Teste termina na data confirmada ${t.endAt}; acompanhamento apenas interno.`;
      this.notice(
        `trial_end:${t.id}:${t.endAt}`,
        String(t.companyId),
        'trial_near_end',
        (t.origin === 'simulated' ? '[SIMULADO] ' : '') + message,
      );
    }
  }
  metrics(): ConversionMetrics {
    const count = (sql: string, ...args: string[]): number =>
      Number(this.db.prepare(sql).get(...args)?.n ?? 0);
    const origins = {} as ConversionMetrics['origins'];
    for (const origin of ['integration', 'manual', 'simulated'] as const) {
      const revenue: Record<string, number> = {};
      for (const r of this.db
        .prepare(
          'SELECT currency,sum(amountMinor) n FROM conversion_payments WHERE origin=? GROUP BY currency',
        )
        .all(origin))
        revenue[String(r.currency)] = Number(r.n);
      origins[origin] = {
        accounts: count('SELECT count(*) n FROM conversion_accounts WHERE origin=?', origin),
        activeTrials: count(
          "SELECT count(*) n FROM conversion_trials WHERE origin=? AND status='active' AND endAt>?",
          origin,
          now(),
        ),
        expiredTrials: count(
          "SELECT count(*) n FROM conversion_trials WHERE origin=? AND status='expired'",
          origin,
        ),
        paying: count(
          'SELECT count(DISTINCT companyId) n FROM conversion_payments WHERE origin=?',
          origin,
        ),
        revenue,
      };
    }
    const real = "recordMode!='simulated'";
    const ids = (sql: string) =>
      new Set(
        this.db
          .prepare(sql)
          .all()
          .map((r) => String(r.id)),
      );
    const qualified = String(this.crm.settings().qualificationThreshold);
    const stages: [string, string, Set<string>, string][] = [
      [
        'identified',
        'Empresas identificadas',
        ids(`SELECT id FROM crm_companies WHERE ${real}`),
        'CRM empresarial',
      ],
      [
        'qualified',
        'Oportunidades qualificadas',
        ids(
          `SELECT c.id FROM crm_companies c WHERE c.recordMode!='simulated' AND (SELECT score FROM crm_qualifications q WHERE q.companyId=c.id AND q.mode='rules' ORDER BY q.rowid DESC LIMIT 1)>=${qualified}`,
        ),
        'Regras CRM',
      ],
      [
        'authorized',
        'Empresas em conversas autorizadas',
        ids(
          "SELECT DISTINCT c.id FROM messaging_conversations m JOIN crm_companies c ON c.id=m.companyId WHERE m.simulated=0 AND c.contactChannel='whatsapp' AND EXISTS(SELECT 1 FROM crm_consents x WHERE x.id=(SELECT id FROM crm_consents y WHERE y.companyId=c.id AND y.channel='whatsapp' ORDER BY rowid DESC LIMIT 1) AND x.status='granted')",
        ),
        'Consentimento CRM',
      ],
      [
        'interested',
        'Clientes interessados',
        ids(
          'SELECT DISTINCT companyId id FROM messaging_conversations WHERE simulated=0 AND companyId IS NOT NULL AND interestedMessageId IS NOT NULL',
        ),
        'Declaração auditada CEO',
      ],
      [
        'sent',
        'Empresas com convite confirmado',
        ids(
          'SELECT DISTINCT companyId id FROM conversion_invites WHERE simulated=0 AND confirmedAt IS NOT NULL',
        ),
        'Provider ou reconciliação auditada',
      ],
      [
        'ceo',
        'Empresas transferidas ao CEO',
        ids(
          "SELECT DISTINCT f.companyId id FROM conversion_followups f JOIN crm_companies c ON c.id=f.companyId WHERE c.recordMode!='simulated'",
        ),
        'Transferência Fase 5',
      ],
      [
        'accounts',
        'Contas criadas',
        ids("SELECT companyId id FROM conversion_accounts WHERE origin!='simulated'"),
        'Factos API/manuais separados',
      ],
      [
        'trial',
        'Empresas com teste confirmado',
        ids("SELECT DISTINCT companyId id FROM conversion_trials WHERE origin!='simulated'"),
        'Datas API/manuais confirmadas',
      ],
      [
        'paying',
        'Clientes pagantes',
        ids("SELECT DISTINCT companyId id FROM conversion_payments WHERE origin!='simulated'"),
        'Recibos API/manuais separados',
      ],
    ];
    const funnel = stages.map(([key, label, values, origin], i) => {
      const previous = i ? stages[i - 1][2] : null;
      const numerator = previous ? [...values].filter((id) => previous.has(id)).length : null;
      return {
        key,
        label,
        count: values.size,
        origin,
        rate: previous?.size ? (numerator ?? 0) / previous.size : null,
        denominator: previous?.size ?? null,
        numerator,
      };
    });
    return {
      origins,
      funnel,
      sectors: this.db
        .prepare(
          "SELECT c.sector,count(DISTINCT a.id) accounts,count(DISTINCT p.companyId) paying FROM crm_companies c LEFT JOIN conversion_accounts a ON a.companyId=c.id LEFT JOIN conversion_payments p ON p.companyId=c.id WHERE c.recordMode!='simulated' GROUP BY c.sector",
        )
        .all() as unknown as ConversionMetrics['sectors'],
      employees: this.db
        .prepare(
          "SELECT i.employeeId employee,count(DISTINCT a.id) accounts,count(DISTINCT p.companyId) paying FROM conversion_invites i JOIN crm_companies c ON c.id=i.companyId LEFT JOIN conversion_accounts a ON a.companyId=c.id LEFT JOIN conversion_payments p ON p.companyId=c.id WHERE c.recordMode!='simulated' AND i.id=(SELECT id FROM conversion_invites x WHERE x.companyId=c.id ORDER BY rowid LIMIT 1) GROUP BY i.employeeId",
        )
        .all() as unknown as ConversionMetrics['employees'],
      awaitingCeo: count(
        "SELECT count(DISTINCT f.companyId) n FROM conversion_followups f JOIN crm_companies c ON c.id=f.companyId JOIN messaging_conversations m ON m.id=f.conversationId WHERE f.closedReason IS NULL AND c.recordMode!='simulated' AND m.owner='ceo'",
      ),
      pendingEvents: count("SELECT count(*) n FROM conversion_events WHERE status='pending'"),
      nearEnd: count(
        "SELECT count(*) n FROM conversion_trials WHERE status='active' AND origin!='simulated' AND endAt<=?",
        new Date(Date.now() + 2 * 86400000).toISOString(),
      ),
      closedLost: count(
        "SELECT count(DISTINCT f.companyId) n FROM conversion_followups f JOIN crm_companies c ON c.id=f.companyId WHERE f.closedReason IS NOT NULL AND c.recordMode!='simulated' AND c.stage='lost'",
      ),
      legacyManual: {
        accounts: count(
          "SELECT count(DISTINCT v.companyId) n FROM crm_verifications v JOIN crm_companies c ON c.id=v.companyId WHERE c.recordMode!='simulated' AND v.stage='account' AND NOT EXISTS(SELECT 1 FROM conversion_accounts a WHERE a.companyId=c.id)",
        ),
        trialsWithoutDates: count(
          "SELECT count(DISTINCT v.companyId) n FROM crm_verifications v JOIN crm_companies c ON c.id=v.companyId WHERE c.recordMode!='simulated' AND v.stage='trial' AND NOT EXISTS(SELECT 1 FROM conversion_trials t WHERE t.companyId=c.id)",
        ),
        payingWithoutAmount: count(
          "SELECT count(DISTINCT v.companyId) n FROM crm_verifications v JOIN crm_companies c ON c.id=v.companyId WHERE c.recordMode!='simulated' AND v.stage='paying' AND NOT EXISTS(SELECT 1 FROM conversion_payments p WHERE p.companyId=c.id)",
        ),
      },
    };
  }
  prune(): number {
    const cutoff = new Date(Date.now() - this.config().retentionDays * 86400000).toISOString();
    const n = this.db
      .prepare(
        "UPDATE conversion_events SET payload=NULL WHERE status='applied' AND receivedAt<? AND payload IS NOT NULL",
      )
      .run(cutoff).changes;
    this.audit(
      'payload_retention',
      `${n} payloads antigos removidos; IDs/digests/factos preservados.`,
    );
    return Number(n);
  }
}
