import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { EmployeeId } from '../../../../core/src/agexa.js';
import type {
  BusinessChannel,
  BusinessSource,
  CommercialOrder,
  CommercialSettings,
  Company,
  CompanyDetail,
  CompanyInput,
  CrmAnalytics,
  CrmSnapshot,
  PipelineStage,
  SalesDraft,
} from '../../../../core/src/crm.js';
import { DEFAULT_COMMERCIAL, PIPELINE } from '../../../../core/src/crm.js';
import type { AgexaKnowledge } from '../../../../core/src/intelligence.js';
import { CrmError } from './error.js';
import { csvCell, normalize, publicWebsite, validateCompany } from './validation.js';

const now = (): string => new Date().toISOString();
export { CrmError } from './error.js';
type Row = Record<string, unknown>;

export class CrmStore {
  private savepoint = 0;
  constructor(private readonly db: DatabaseSync) {
    this.atomic(() =>
      db.exec(`
   CREATE TABLE IF NOT EXISTS crm_sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,url TEXT,termsUrl TEXT,permissionEvidence TEXT NOT NULL,attribution TEXT NOT NULL,enabled INTEGER NOT NULL,termsReviewed INTEGER NOT NULL,commercialReuseAllowed INTEGER NOT NULL,createdAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS crm_companies(id TEXT PRIMARY KEY,name TEXT NOT NULL,sector TEXT NOT NULL,city TEXT NOT NULL,province TEXT NOT NULL,country TEXT NOT NULL,website TEXT NOT NULL,businessPage TEXT NOT NULL,contactChannel TEXT NOT NULL,businessContact TEXT NOT NULL,needs TEXT NOT NULL,nextAction TEXT NOT NULL,sourceId TEXT NOT NULL REFERENCES crm_sources(id),discoveredAt TEXT NOT NULL,updatedAt TEXT NOT NULL,recordMode TEXT NOT NULL,stage TEXT NOT NULL,owner TEXT NOT NULL,facts TEXT NOT NULL,dedupeKey TEXT NOT NULL UNIQUE,lastInteraction TEXT);
   CREATE TABLE IF NOT EXISTS crm_qualifications(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES crm_companies(id),taskId TEXT,mode TEXT NOT NULL,score INTEGER,reason TEXT NOT NULL,criteria TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(taskId,companyId,mode));
   CREATE TABLE IF NOT EXISTS crm_consents(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES crm_companies(id),channel TEXT NOT NULL,status TEXT NOT NULL,evidence TEXT NOT NULL,origin TEXT NOT NULL,createdAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS crm_drafts(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES crm_companies(id),employeeId TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,taskId TEXT,mode TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(companyId,kind,version),UNIQUE(taskId,companyId,kind));
   CREATE TABLE IF NOT EXISTS crm_activities(id INTEGER PRIMARY KEY AUTOINCREMENT,companyId TEXT REFERENCES crm_companies(id),taskId TEXT,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,createdAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS crm_handoffs(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES crm_companies(id),summary TEXT NOT NULL,officialUrl TEXT,status TEXT NOT NULL,createdAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS crm_verifications(id TEXT PRIMARY KEY,companyId TEXT NOT NULL REFERENCES crm_companies(id),stage TEXT NOT NULL,evidence TEXT NOT NULL,occurredAt TEXT NOT NULL,createdAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS crm_batches(id TEXT PRIMARY KEY,sourceId TEXT NOT NULL REFERENCES crm_sources(id),payload TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,result TEXT,startedAt TEXT);
   CREATE TABLE IF NOT EXISTS crm_orders(id TEXT PRIMARY KEY,goal TEXT NOT NULL,sourceId TEXT NOT NULL REFERENCES crm_sources(id),sector TEXT NOT NULL,city TEXT NOT NULL,useAI INTEGER NOT NULL,status TEXT NOT NULL,planTaskId TEXT NOT NULL,taskBudget INTEGER NOT NULL,inferenceBudget INTEGER NOT NULL,createdAt TEXT NOT NULL,expanded INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS crm_assignments(orderId TEXT NOT NULL REFERENCES crm_orders(id),taskId TEXT NOT NULL UNIQUE,companyId TEXT REFERENCES crm_companies(id),employeeId TEXT NOT NULL,PRIMARY KEY(orderId,taskId));
   CREATE TABLE IF NOT EXISTS crm_source_usage(id TEXT PRIMARY KEY,sourceId TEXT NOT NULL REFERENCES crm_sources(id),operation TEXT NOT NULL,createdAt TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS crm_company_filters ON crm_companies(stage,city,sector);
   CREATE INDEX IF NOT EXISTS crm_activity_company ON crm_activities(companyId,id);
   PRAGMA user_version=3;`),
    );
  }
  atomic<T>(work: () => T): T {
    const id = `crm_${++this.savepoint}`;
    this.db.exec(`SAVEPOINT ${id}`);
    try {
      const value = work();
      this.db.exec(`RELEASE ${id}`);
      return value;
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${id}; RELEASE ${id}`);
      throw error;
    }
  }
  activity(
    action: string,
    detail: string,
    companyId: string | null = null,
    taskId: string | null = null,
    actor = 'CEO',
  ): void {
    this.db
      .prepare(
        'INSERT INTO crm_activities(companyId,taskId,actor,action,detail,createdAt) VALUES (?,?,?,?,?,?)',
      )
      .run(companyId, taskId, actor, action, detail.slice(0, 12000), now());
  }
  settings(): CommercialSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='commercial'").get();
    return row ? (JSON.parse(String(row.value)) as CommercialSettings) : { ...DEFAULT_COMMERCIAL };
  }
  saveSettings(value: CommercialSettings): void {
    for (const key of ['prioritySectors', 'priorityCities'] as const)
      if (
        !Array.isArray(value[key]) ||
        value[key].length > 30 ||
        value[key].some((v) => typeof v !== 'string' || !v.trim() || v.length > 100)
      )
        throw new CrmError(`Configuração inválida: ${key}`);
    for (const [key, min, max] of [
      ['qualificationThreshold', 0, 100],
      ['maxImportRows', 1, 200],
      ['maxResearchPerHour', 1, 30],
      ['maxCampaignLeads', 1, 3],
    ] as const)
      if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)
        throw new CrmError(`Limite inválido: ${key}`);
    if (typeof value.contactPolicy !== 'string' || value.contactPolicy.length > 1000)
      throw new CrmError('Política comercial inválida');
    this.atomic(() => {
      this.db
        .prepare(
          "INSERT INTO settings(key,value) VALUES ('commercial',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(value));
      this.activity('commercial_settings', 'Limites e prioridades confirmados pelo CEO');
    });
  }
  sources(): BusinessSource[] {
    return this.db
      .prepare('SELECT * FROM crm_sources ORDER BY createdAt DESC,rowid DESC')
      .all()
      .map((row) => this.sourceRow(row));
  }
  private sourceRow(row: Row): BusinessSource {
    return {
      ...row,
      enabled: !!row.enabled,
      termsReviewed: !!row.termsReviewed,
      commercialReuseAllowed: !!row.commercialReuseAllowed,
    } as unknown as BusinessSource;
  }
  source(id: string): BusinessSource {
    const row = this.db.prepare('SELECT * FROM crm_sources WHERE id=?').get(id);
    if (!row) throw new CrmError('Fonte inexistente', 404);
    return this.sourceRow(row);
  }
  createSource(value: Omit<BusinessSource, 'id' | 'createdAt'>): BusinessSource {
    if (
      !value ||
      typeof value.name !== 'string' ||
      !value.name.trim() ||
      value.name.length > 200 ||
      !['manual', 'csv', 'website'].includes(value.kind)
    )
      throw new CrmError('Fonte inválida');
    if (
      typeof value.permissionEvidence !== 'string' ||
      !value.permissionEvidence.trim() ||
      value.permissionEvidence.length > 2000
    )
      throw new CrmError('Registar a origem e autorização de reutilização dos dados');
    if (!value.termsReviewed || !value.commercialReuseAllowed)
      throw new CrmError(
        'Confirmar termos e permissão de reutilização comercial antes de criar a fonte',
      );
    if (value.kind === 'website' && !value.url) throw new CrmError('Website da fonte obrigatório');
    if (value.url) publicWebsite(value.url);
    if (value.termsUrl) publicWebsite(value.termsUrl);
    if (typeof value.attribution !== 'string' || value.attribution.length > 1000)
      throw new CrmError('Atribuição inválida');
    return this.atomic(() => {
      const id = randomUUID();
      this.db
        .prepare('INSERT INTO crm_sources VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          value.name.trim(),
          value.kind,
          value.url,
          value.termsUrl,
          value.permissionEvidence,
          value.attribution,
          value.enabled ? 1 : 0,
          1,
          1,
          now(),
        );
      this.activity('source_created', `${value.name}: ${value.kind}; autorização registada`);
      return this.source(id);
    });
  }
  setSource(id: string, enabled: boolean): void {
    this.source(id);
    this.atomic(() => {
      this.db.prepare('UPDATE crm_sources SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
      this.activity('source_toggled', `${id}: ${enabled ? 'ativa' : 'pausada'}`);
    });
  }
  eligibility(id: string, channel?: BusinessChannel): Company['eligibility'] {
    const company = this.db
      .prepare('SELECT contactChannel,businessContact FROM crm_companies WHERE id=?')
      .get(id);
    if (!company) throw new CrmError('Empresa inexistente', 404);
    const selected = channel ?? (company.contactChannel as BusinessChannel);
    const consent = this.db
      .prepare(
        'SELECT status FROM crm_consents WHERE companyId=? AND channel=? ORDER BY rowid DESC LIMIT 1',
      )
      .get(id, selected);
    const allowed =
      selected !== 'none' && !!company.businessContact && consent?.status === 'granted';
    return {
      allowed,
      channel: selected,
      reason: allowed
        ? 'Consentimento explícito registado para este canal'
        : 'Sem consentimento ativo e contacto empresarial confirmado neste canal',
    };
  }
  company(id: string): Company {
    const row = this.db.prepare('SELECT * FROM crm_companies WHERE id=?').get(id);
    if (!row) throw new CrmError('Empresa inexistente', 404);
    const qualification = this.db
      .prepare(
        "SELECT score,reason FROM crm_qualifications WHERE companyId=? AND mode='rules' ORDER BY rowid DESC LIMIT 1",
      )
      .get(id);
    return {
      ...row,
      facts: JSON.parse(String(row.facts)),
      score: qualification?.score ?? null,
      scoreReason: qualification?.reason ?? null,
      eligibility: this.eligibility(id),
    } as unknown as Company;
  }
  list(
    filters: {
      search?: string;
      sector?: string;
      city?: string;
      stage?: string;
      page?: number;
    } = {},
  ): { items: Company[]; total: number; page: number } {
    const clauses: string[] = [];
    const values: string[] = [];
    for (const key of ['sector', 'city', 'stage'] as const)
      if (filters[key]) {
        clauses.push(`${key}=? COLLATE NOCASE`);
        values.push(filters[key]!.slice(0, 100));
      }
    if (filters.search) {
      clauses.push("(name LIKE ? ESCAPE '\\' OR needs LIKE ? ESCAPE '\\')");
      const term = '%' + filters.search.slice(0, 200).replace(/[\\%_]/g, '\\$&') + '%';
      values.push(term, term);
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const rows = this.db
      .prepare(
        `SELECT id FROM crm_companies${where} ORDER BY updatedAt DESC,rowid DESC LIMIT 50 OFFSET ?`,
      )
      .all(...values, (page - 1) * 50);
    const total = Number(
      this.db.prepare(`SELECT count(*) as n FROM crm_companies${where}`).get(...values)?.n ?? 0,
    );
    return { items: rows.map((row) => this.company(String(row.id))), total, page };
  }
  detail(id: string): CompanyDetail {
    const company = this.company(id);
    return {
      company,
      source: this.source(company.sourceId),
      qualifications: this.db
        .prepare('SELECT * FROM crm_qualifications WHERE companyId=? ORDER BY rowid DESC LIMIT 100')
        .all(id)
        .map((row) => ({
          ...row,
          criteria: JSON.parse(String(row.criteria)),
        })) as unknown as CompanyDetail['qualifications'],
      consents: this.db
        .prepare('SELECT * FROM crm_consents WHERE companyId=? ORDER BY rowid DESC LIMIT 100')
        .all(id) as unknown as CompanyDetail['consents'],
      drafts: this.drafts(id),
      activities: this.db
        .prepare('SELECT * FROM crm_activities WHERE companyId=? ORDER BY id DESC LIMIT 100')
        .all(id) as unknown as CompanyDetail['activities'],
      handoffs: this.db
        .prepare('SELECT * FROM crm_handoffs WHERE companyId=? ORDER BY rowid DESC LIMIT 50')
        .all(id) as unknown as CompanyDetail['handoffs'],
    };
  }
  importCompanies(
    records: CompanyInput[],
    sourceId: string,
    taskId: string,
    mode: Company['recordMode'],
  ): { companyIds: string[]; created: number; duplicates: number } {
    const source = this.source(sourceId);
    if (!source.enabled || !source.commercialReuseAllowed)
      throw new CrmError('Fonte pausada ou sem autorização');
    if (!records.length || records.length > this.settings().maxImportRows)
      throw new CrmError('Lista vazia ou limite de importação excedido');
    records.forEach(validateCompany);
    return this.atomic(() => {
      const ids: string[] = [];
      let created = 0;
      let duplicates = 0;
      for (const input of records) {
        const key = [
          normalize(input.name),
          normalize(input.city ?? ''),
          normalize(input.country ?? ''),
        ].join('|');
        const website = input.website ? publicWebsite(input.website).toString() : '';
        const existing = this.db
          .prepare(
            "SELECT id FROM crm_companies WHERE dedupeKey=? OR (website!='' AND website=? AND city=? COLLATE NOCASE) LIMIT 1",
          )
          .get(key, website, input.city ?? '');
        if (existing) {
          ids.push(String(existing.id));
          duplicates++;
          continue;
        }
        const id = randomUUID();
        const time = now();
        const facts = {
          usesAppointments: input.usesAppointments ?? null,
          organizationNeed: input.organizationNeed ?? null,
          hasSchedulingSystem: input.hasSchedulingSystem ?? null,
          sufficientInfo: input.sufficientInfo ?? null,
        };
        this.db
          .prepare('INSERT INTO crm_companies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(
            id,
            input.name.trim(),
            input.sector ?? '',
            input.city ?? '',
            input.province ?? '',
            input.country ?? '',
            website,
            input.businessPage ?? '',
            input.contactChannel ?? 'none',
            input.businessContact ?? '',
            input.needs ?? '',
            input.nextAction ?? '',
            sourceId,
            time,
            time,
            mode,
            'identified',
            'hunter',
            JSON.stringify(facts),
            key,
            null,
          );
        this.activity(
          'company_imported',
          `Empresa registada de ${source.name}; modo ${mode}`,
          id,
          taskId,
          'hunter',
        );
        ids.push(id);
        created++;
      }
      return { companyIds: [...new Set(ids)], created, duplicates };
    });
  }
  updateCompany(id: string, input: CompanyInput, actor = 'CEO'): Company {
    const previous = this.company(id);
    validateCompany(input);
    if (
      normalize(previous.name) !== normalize(input.name) ||
      normalize(previous.city) !== normalize(input.city ?? '') ||
      normalize(previous.country) !== normalize(input.country ?? '')
    )
      throw new CrmError(
        'Nome, cidade e país identificam a empresa; criar um registo separado para outra entidade',
      );
    return this.atomic(() => {
      const facts = {
        usesAppointments: input.usesAppointments ?? null,
        organizationNeed: input.organizationNeed ?? null,
        hasSchedulingSystem: input.hasSchedulingSystem ?? null,
        sufficientInfo: input.sufficientInfo ?? null,
      };
      this.db
        .prepare(
          'UPDATE crm_companies SET sector=?,province=?,website=?,businessPage=?,contactChannel=?,businessContact=?,needs=?,nextAction=?,facts=?,updatedAt=? WHERE id=?',
        )
        .run(
          input.sector ?? '',
          input.province ?? '',
          input.website ?? '',
          input.businessPage ?? '',
          input.contactChannel ?? 'none',
          input.businessContact ?? '',
          input.needs ?? '',
          input.nextAction ?? '',
          JSON.stringify(facts),
          now(),
          id,
        );
      if (
        (previous.businessContact !== (input.businessContact ?? '') ||
          previous.contactChannel !== (input.contactChannel ?? 'none')) &&
        (input.contactChannel ?? 'none') !== 'none'
      ) {
        this.db
          .prepare('INSERT INTO crm_consents VALUES (?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            id,
            input.contactChannel ?? 'none',
            'revoked',
            'Contacto/canal alterado; obter novo consentimento',
            'Controlo interno de segurança',
            now(),
          );
      }
      if (
        JSON.stringify(previous.facts) !== JSON.stringify(facts) ||
        previous.sector !== (input.sector ?? '')
      ) {
        this.db
          .prepare('INSERT INTO crm_qualifications VALUES (?,?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            id,
            null,
            'rules',
            null,
            'Dados alterados; executar nova qualificação',
            JSON.stringify([]),
            now(),
          );
        if (['qualified', 'authorized', 'prepared'].includes(previous.stage))
          this.db.prepare("UPDATE crm_companies SET stage='analysis' WHERE id=?").run(id);
      }
      this.activity(
        'company_updated',
        JSON.stringify({ before: previous, after: input }),
        id,
        null,
        actor,
      );
      return this.company(id);
    });
  }
  assignOwner(id: string, employeeId: EmployeeId): void {
    this.company(id);
    if (
      !['nexus', 'hunter', 'atlas', 'maya', 'luna', 'victor', 'sophia', 'orion'].includes(
        employeeId,
      )
    )
      throw new CrmError('Funcionário inválido');
    this.atomic(() => {
      this.db
        .prepare('UPDATE crm_companies SET owner=?,updatedAt=? WHERE id=?')
        .run(employeeId, now(), id);
      this.activity('owner_assigned', employeeId, id);
    });
  }
  consent(
    id: string,
    channel: BusinessChannel,
    status: 'granted' | 'revoked' | 'denied',
    evidence: string,
    origin: string,
  ): void {
    this.company(id);
    if (
      !['website', 'email', 'whatsapp', 'business_phone'].includes(channel) ||
      !['granted', 'revoked', 'denied'].includes(status) ||
      !evidence?.trim() ||
      !origin?.trim() ||
      evidence.length > 2000 ||
      origin.length > 500
    )
      throw new CrmError('Consentimento exige canal, estado, origem e evidência');
    this.atomic(() => {
      this.db
        .prepare('INSERT INTO crm_consents VALUES (?,?,?,?,?,?,?)')
        .run(randomUUID(), id, channel, status, evidence, origin, now());
      this.activity(
        'consent_recorded',
        `${channel}: ${status}; origem ${origin}; evidência ${evidence}`,
        id,
      );
      if (status !== 'granted' && ['authorized', 'prepared'].includes(this.company(id).stage))
        this.db
          .prepare("UPDATE crm_companies SET stage='analysis',updatedAt=? WHERE id=?")
          .run(now(), id);
    });
  }
  qualify(id: string, taskId: string): Record<string, unknown> {
    const company = this.company(id);
    const facts = company.facts;
    const settings = this.settings();
    const criteria = [
      {
        criterion: 'Marcações confirmadas',
        value: facts.usesAppointments,
        points: facts.usesAppointments === true ? 30 : 0,
      },
      {
        criterion: 'Setor prioritário configurado',
        value: company.sector || null,
        points: settings.prioritySectors.some((s) =>
          normalize(company.sector).includes(normalize(s)),
        )
          ? 20
          : 0,
      },
      {
        criterion: 'Necessidade de organização comprovada',
        value: facts.organizationNeed,
        points: facts.organizationNeed === true ? 20 : 0,
      },
      {
        criterion: 'Ausência de sistema confirmada',
        value: facts.hasSchedulingSystem,
        points: facts.hasSchedulingSystem === false ? 10 : 0,
      },
      {
        criterion: 'Informação suficiente confirmada',
        value: facts.sufficientInfo,
        points: facts.sufficientInfo === true ? 10 : 0,
      },
      {
        criterion: 'Localização em Moçambique declarada',
        value: company.country || null,
        points: ['mocambique', 'mozambique', 'mz'].includes(normalize(company.country)) ? 10 : 0,
      },
    ];
    const score = criteria.reduce((total, c) => total + c.points, 0);
    const reason =
      'Apenas dados declarados ou observados na fonte; desconhecido não recebe pontos. Consentimento não altera a adequação.';
    this.atomic(() => {
      this.db
        .prepare('INSERT OR IGNORE INTO crm_qualifications VALUES (?,?,?,?,?,?,?,?)')
        .run(randomUUID(), id, taskId, 'rules', score, reason, JSON.stringify(criteria), now());
      if (['identified', 'analysis', 'qualified'].includes(company.stage))
        this.db
          .prepare('UPDATE crm_companies SET stage=?,owner=?,updatedAt=? WHERE id=?')
          .run(
            score >= settings.qualificationThreshold ? 'qualified' : 'analysis',
            'atlas',
            now(),
            id,
          );
      this.activity(
        'qualification_rules',
        `${score}/100; elegibilidade de contacto: ${this.eligibility(id).allowed}`,
        id,
        taskId,
        'atlas',
      );
    });
    return {
      companyId: id,
      score,
      criteria,
      reason,
      eligibility: this.eligibility(id),
      inference: false,
    };
  }
  aiQualification(id: string, taskId: string, result: Record<string, unknown>): void {
    this.company(id);
    this.atomic(() => {
      this.db
        .prepare('INSERT OR IGNORE INTO crm_qualifications VALUES (?,?,?,?,?,?,?,?)')
        .run(
          randomUUID(),
          id,
          taskId,
          result.executionMode === 'test' ? 'test' : 'ai',
          null,
          String(result.summary),
          JSON.stringify(result.observations ?? []),
          now(),
        );
      this.activity(
        'qualification_ai',
        'Análise IA separada; pontuação por regras preservada',
        id,
        taskId,
        'atlas',
      );
    });
  }
  drafts(id?: string): SalesDraft[] {
    return this.db
      .prepare(
        `SELECT * FROM crm_drafts ${id ? 'WHERE companyId=?' : ''} ORDER BY rowid DESC LIMIT 100`,
      )
      .all(...(id ? [id] : []))
      .map((row) => ({ ...row, internalOnly: true })) as unknown as SalesDraft[];
  }
  addDraft(
    companyId: string,
    employeeId: EmployeeId,
    kind: SalesDraft['kind'],
    body: string,
    mode: SalesDraft['mode'],
    taskId: string | null,
  ): SalesDraft {
    this.company(companyId);
    if (
      !['maya', 'luna', 'victor', 'sophia'].includes(employeeId) ||
      !['approach', 'simulation', 'objections', 'invitation'].includes(kind) ||
      typeof body !== 'string' ||
      !body.trim() ||
      body.length > 6000
    )
      throw new CrmError('Rascunho operacional inválido');
    return this.atomic(() => {
      if (taskId) {
        const old = this.db
          .prepare('SELECT id FROM crm_drafts WHERE taskId=? AND companyId=? AND kind=?')
          .get(taskId, companyId, kind);
        if (old) return this.drafts(companyId).find((d) => d.id === old.id)!;
      }
      const version =
        Number(
          this.db
            .prepare('SELECT max(version) as n FROM crm_drafts WHERE companyId=? AND kind=?')
            .get(companyId, kind)?.n ?? 0,
        ) + 1;
      const id = randomUUID();
      this.db
        .prepare('INSERT INTO crm_drafts VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, companyId, employeeId, kind, body, version, 'proposed', taskId, mode, now());
      this.activity(
        'draft_prepared',
        `${kind} v${version}; ${mode}; apenas interno`,
        companyId,
        taskId,
        employeeId,
      );
      return this.drafts(companyId).find((d) => d.id === id)!;
    });
  }
  reviewDraft(id: string, status: 'approved' | 'rejected'): void {
    const row = this.db.prepare('SELECT * FROM crm_drafts WHERE id=?').get(id);
    if (!row) throw new CrmError('Rascunho inexistente', 404);
    if (!['approved', 'rejected'].includes(status)) throw new CrmError('Revisão inválida');
    if (
      status === 'approved' &&
      row.kind !== 'simulation' &&
      !this.eligibility(String(row.companyId)).allowed
    )
      throw new CrmError('Aprovação para contacto exige consentimento ativo por canal');
    this.atomic(() => {
      this.db.prepare('UPDATE crm_drafts SET status=? WHERE id=?').run(status, id);
      this.activity('draft_reviewed', `${id}: ${status}; não enviado`, String(row.companyId));
    });
  }
  move(
    id: string,
    stage: PipelineStage,
    verification?: { independentlyVerified: boolean; evidence: string; occurredAt: string },
    knowledge?: AgexaKnowledge,
  ): void {
    const company = this.company(id);
    if (!PIPELINE.some(([key]) => key === stage)) throw new CrmError('Etapa inválida');
    if (
      stage === 'qualified' &&
      (company.score === null || company.score < this.settings().qualificationThreshold)
    )
      throw new CrmError('Qualificação por regras ainda insuficiente');
    if (stage === 'authorized' && !company.eligibility.allowed)
      throw new CrmError('Sem consentimento ativo para contacto');
    if (
      stage === 'prepared' &&
      (!company.eligibility.allowed ||
        !this.drafts(id).some(
          (d) => d.status === 'approved' && d.kind === 'approach' && d.mode !== 'test',
        ))
    )
      throw new CrmError('Requer consentimento e abordagem aprovada, sem simulação');
    const external = [
      'conversation',
      'interested',
      'link_sent',
      'ceo',
      'account',
      'trial',
      'paying',
    ].includes(stage);
    if (external) {
      if (
        ['conversation', 'interested', 'link_sent', 'ceo'].includes(stage) &&
        !company.eligibility.allowed
      )
        throw new CrmError(
          'Registar consentimento ativo para este canal antes de confirmar uma conversa comercial',
        );
      if (
        ['link_sent', 'trial'].includes(stage) &&
        (!knowledge?.signupUrl || !knowledge.trialAvailable)
      )
        throw new CrmError('Confirmar URL e oferta antes de registar este evento');
      if (
        verification?.independentlyVerified !== true ||
        !verification.evidence?.trim() ||
        verification.evidence.length > 2000 ||
        !Number.isFinite(Date.parse(verification.occurredAt)) ||
        Date.parse(verification.occurredAt) > Date.now() + 60000
      )
        throw new CrmError(
          'Esta etapa exige evidência independente confirmada pelo CEO e data válida',
        );
      if (company.recordMode === 'simulated')
        throw new CrmError('Dados simulados não confirmam conversas, envios ou conversões');
      const seen = (key: string): boolean =>
        !!this.db
          .prepare('SELECT id FROM crm_verifications WHERE companyId=? AND stage=? LIMIT 1')
          .get(id, key);
      if (['interested', 'link_sent', 'ceo'].includes(stage) && !seen('conversation'))
        throw new CrmError('Registar evidência de conversa real primeiro');
      if (stage === 'link_sent' && !seen('interested'))
        throw new CrmError('Registar aceitação/interesse real primeiro');
      if (stage === 'ceo' && !seen('link_sent'))
        throw new CrmError('Não concluir handoff sem envio confirmado do link');
    }
    this.atomic(() => {
      if (external)
        this.db
          .prepare('INSERT INTO crm_verifications VALUES (?,?,?,?,?,?)')
          .run(randomUUID(), id, stage, verification!.evidence, verification!.occurredAt, now());
      this.db
        .prepare(
          'UPDATE crm_companies SET stage=?,updatedAt=?,lastInteraction=CASE WHEN ? THEN ? ELSE lastInteraction END WHERE id=?',
        )
        .run(stage, now(), external ? 1 : 0, external ? verification!.occurredAt : null, id);
      this.activity(
        'pipeline_changed',
        `${company.stage} → ${stage}${external ? '; confirmação manual com evidência: ' + verification!.evidence : ''}`,
        id,
      );
    });
  }
  handoff(id: string, knowledge: AgexaKnowledge): Record<string, unknown> {
    const company = this.company(id);
    const detail = this.detail(id);
    const summary = JSON.stringify({
      company: company.name,
      contact: company.eligibility.allowed ? company.businessContact : null,
      consent: company.eligibility,
      needs: company.needs,
      stage: company.stage,
      preparedObjectionScripts: detail.drafts
        .filter((d) => d.kind === 'objections')
        .map((d) => d.body),
      officialUrl: knowledge.signupUrl,
      linkSent: !!this.db
        .prepare("SELECT id FROM crm_verifications WHERE companyId=? AND stage='link_sent' LIMIT 1")
        .get(id),
      conversationConfirmed: !!this.db
        .prepare(
          "SELECT id FROM crm_verifications WHERE companyId=? AND stage='conversation' LIMIT 1",
        )
        .get(id),
      nextAction:
        'Preparação interna; confirmar conversa e envio real antes de concluir a transferência.',
    });
    return this.atomic(() => {
      const handoffId = randomUUID();
      this.db
        .prepare('INSERT INTO crm_handoffs VALUES (?,?,?,?,?,?)')
        .run(handoffId, id, summary, knowledge.signupUrl, 'prepared', now());
      this.activity(
        'handoff_prepared',
        'Preparação interna; transferência não concluída',
        id,
        null,
        'sophia',
      );
      return { id: handoffId, status: 'prepared', summary, completed: false };
    });
  }
  createBatch(sourceId: string, payload: Record<string, unknown>): string {
    const source = this.source(sourceId);
    if (!source.enabled) throw new CrmError('Fonte pausada');
    if (JSON.stringify(payload).length > 60000) throw new CrmError('Importação demasiado extensa');
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO crm_batches(id,sourceId,payload,status,createdAt,result) VALUES (?,?,?,?,?,?)',
      )
      .run(id, sourceId, JSON.stringify(payload), 'queued', now(), null);
    return id;
  }
  batch(id: string): {
    id: string;
    sourceId: string;
    payload: Record<string, unknown>;
    status: string;
  } {
    const row = this.db.prepare('SELECT * FROM crm_batches WHERE id=?').get(id);
    if (!row) throw new CrmError('Importação inexistente', 404);
    return { ...row, payload: JSON.parse(String(row.payload)) } as unknown as ReturnType<
      CrmStore['batch']
    >;
  }
  reserveSourceUse(sourceId: string, operationId: string, operation: string): void {
    this.atomic(() => {
      if (!this.source(sourceId).enabled) throw new CrmError('Fonte pausada');
      if (this.db.prepare('SELECT id FROM crm_source_usage WHERE id=?').get(operationId))
        throw new CrmError('Operação de pesquisa já iniciada; evitar repetição incerta');
      const count = Number(
        this.db
          .prepare('SELECT count(*) as n FROM crm_source_usage WHERE sourceId=? AND createdAt>=?')
          .get(sourceId, new Date(Date.now() - 3600000).toISOString())?.n ?? 0,
      );
      if (count >= this.settings().maxResearchPerHour)
        throw new CrmError('Limite horário de importações/pesquisas desta fonte atingido');
      this.db
        .prepare('INSERT INTO crm_source_usage VALUES (?,?,?,?)')
        .run(operationId, sourceId, operation, now());
    });
  }
  beginResearch(id: string): void {
    this.atomic(() => {
      const batch = this.batch(id);
      this.reserveSourceUse(batch.sourceId, `batch-${id}`, 'import');
      this.db
        .prepare("UPDATE crm_batches SET status='running',startedAt=? WHERE id=?")
        .run(now(), id);
    });
  }
  finishBatch(id: string, result: Record<string, unknown>, status = 'completed'): void {
    this.db
      .prepare('UPDATE crm_batches SET status=?,result=? WHERE id=?')
      .run(status, JSON.stringify(result), id);
  }
  analytics(): CrmAnalytics {
    const count = (sql: string): number => Number(this.db.prepare(sql).get()?.n ?? 0);
    const stages = Object.fromEntries(
      this.db
        .prepare(
          "SELECT stage,count(*) as n FROM crm_companies WHERE recordMode!='simulated' GROUP BY stage",
        )
        .all()
        .map((row) => [String(row.stage), Number(row.n)]),
    );
    const companies = this.db
      .prepare("SELECT id FROM crm_companies WHERE recordMode!='simulated'")
      .all();
    const verified = (stage: string): number | null => {
      const n = Number(
        this.db
          .prepare('SELECT count(DISTINCT companyId) as n FROM crm_verifications WHERE stage=?')
          .get(stage)?.n ?? 0,
      );
      return n || null;
    };
    return {
      companies: companies.length,
      qualified: count(
        `SELECT count(*) as n FROM crm_companies c JOIN crm_qualifications q ON q.rowid=(SELECT max(rowid) FROM crm_qualifications WHERE companyId=c.id AND mode='rules') WHERE q.score>=${this.settings().qualificationThreshold} AND c.recordMode!='simulated'`,
      ),
      highPriority: count(
        "SELECT count(DISTINCT c.id) as n FROM crm_companies c JOIN crm_qualifications q ON q.rowid=(SELECT max(rowid) FROM crm_qualifications WHERE companyId=c.id AND mode='rules') WHERE q.score>=80 AND c.recordMode!='simulated'",
      ),
      authorizedContacts: companies.filter((row) => this.eligibility(String(row.id)).allowed)
        .length,
      drafts: count(
        "SELECT count(*) as n FROM crm_drafts d JOIN crm_companies c ON c.id=d.companyId WHERE d.mode!='test' AND c.recordMode!='simulated'",
      ),
      approvedDrafts: count(
        "SELECT count(*) as n FROM crm_drafts d JOIN crm_companies c ON c.id=d.companyId WHERE d.mode!='test' AND c.recordMode!='simulated' AND d.kind!='simulation' AND d.status='approved'",
      ),
      opportunities: companies.length - (stages.lost ?? 0),
      simulatedCompanies: count(
        "SELECT count(*) as n FROM crm_companies WHERE recordMode='simulated'",
      ),
      confirmedAccounts: verified('account'),
      confirmedTrials: verified('trial'),
      confirmedPaying: verified('paying'),
      sentMessages: null,
      revenue: null,
      stages,
      sources: this.db
        .prepare(
          "SELECT s.name,count(c.id) as count FROM crm_sources s LEFT JOIN crm_companies c ON c.sourceId=s.id AND c.recordMode!='simulated' GROUP BY s.id",
        )
        .all() as unknown as CrmAnalytics['sources'],
      agents: this.db
        .prepare(
          "SELECT employeeId,sum(status='completed') as completed,sum(status='error') as errors FROM tasks GROUP BY employeeId",
        )
        .all() as unknown as CrmAnalytics['agents'],
      provenance:
        'Dados registados; conversões apenas com evidência independente confirmada pelo CEO',
    };
  }
  orders(): CommercialOrder[] {
    return this.db
      .prepare('SELECT * FROM crm_orders ORDER BY rowid DESC LIMIT 50')
      .all()
      .map((row) => ({ ...row, useAI: !!row.useAI })) as unknown as CommercialOrder[];
  }
  order(id: string): CommercialOrder {
    const row = this.db.prepare('SELECT * FROM crm_orders WHERE id=?').get(id);
    if (!row) throw new CrmError('Ordem comercial inexistente', 404);
    return { ...row, useAI: !!row.useAI } as unknown as CommercialOrder;
  }
  saveOrder(order: CommercialOrder): void {
    this.db
      .prepare(
        'INSERT INTO crm_orders(id,goal,sourceId,sector,city,useAI,status,planTaskId,taskBudget,inferenceBudget,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        order.id,
        order.goal,
        order.sourceId,
        order.sector,
        order.city,
        order.useAI ? 1 : 0,
        order.status,
        order.planTaskId,
        order.taskBudget,
        order.inferenceBudget,
        order.createdAt,
      );
  }
  setOrder(id: string, status: CommercialOrder['status']): void {
    this.db.prepare('UPDATE crm_orders SET status=? WHERE id=?').run(status, id);
  }
  assign(
    orderId: string,
    taskId: string,
    employeeId: EmployeeId,
    companyId: string | null = null,
  ): void {
    this.db
      .prepare('INSERT INTO crm_assignments VALUES (?,?,?,?)')
      .run(orderId, taskId, companyId, employeeId);
  }
  assignments(id: string): { taskId: string; employeeId: EmployeeId; companyId: string | null }[] {
    return this.db
      .prepare(
        'SELECT taskId,employeeId,companyId FROM crm_assignments WHERE orderId=? ORDER BY rowid',
      )
      .all(id) as unknown as ReturnType<CrmStore['assignments']>;
  }
  snapshot(): CrmSnapshot {
    return {
      companies: this.list().items,
      totalCompanies: this.list().total,
      sources: this.sources(),
      drafts: this.drafts(),
      settings: this.settings(),
      analytics: this.analytics(),
      batches: this.db
        .prepare(
          'SELECT id,sourceId,status,createdAt,result FROM crm_batches ORDER BY rowid DESC LIMIT 30',
        )
        .all()
        .map((row) => ({
          ...row,
          result: row.result ? JSON.parse(String(row.result)) : null,
        })) as unknown as CrmSnapshot['batches'],
      orders: this.orders(),
    };
  }
  exportCsv(): string {
    const rows = this.db
      .prepare(
        'SELECT c.name,c.sector,c.city,c.country,c.website,c.stage,s.name as source,s.attribution,c.discoveredAt,c.recordMode FROM crm_companies c JOIN crm_sources s ON s.id=c.sourceId ORDER BY c.rowid LIMIT 5000',
      )
      .all();
    const columns = [
      'name',
      'sector',
      'city',
      'country',
      'website',
      'stage',
      'source',
      'attribution',
      'discoveredAt',
      'recordMode',
    ];
    return [
      columns.join(','),
      ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(',')),
    ].join('\r\n');
  }
}
