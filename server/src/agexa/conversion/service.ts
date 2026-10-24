import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { SalesTask } from '../../../../core/src/agexa.js';
import type {
  ConversionConfig,
  ConversionFact,
  ConversionSnapshot,
} from '../../../../core/src/conversion.js';
import type { AgexaKnowledge } from '../../../../core/src/intelligence.js';
import type { MessagingDraft } from '../../../../core/src/messaging.js';
import { CrmError } from '../crm/error.js';
import type { CrmStore } from '../crm/store.js';
import { publicWebsite } from '../crm/validation.js';
import { AgexaBase44Connector } from './connector.js';
import { isoDate, opaque } from './contract.js';
import { ConversionStore } from './store.js';
const now = () => new Date().toISOString();
const urls = (body: string): string[] =>
  body.match(/https?:\/\/[^\s<>"')]+/gi)?.map((v) => v.replace(/[.,;!?]+$/, '')) ?? [];
export class ConversionService {
  readonly store: ConversionStore;
  private activeSync: AbortController | null = null;
  private closed = false;
  constructor(
    db: DatabaseSync,
    crm: CrmStore,
    private readonly knowledge: () => AgexaKnowledge,
    private readonly changed: () => void,
    readonly connector = new AgexaBase44Connector(),
    private readonly secret = () => process.env.AGEXA_BASE44_EVENT_SECRET ?? '',
  ) {
    this.store = new ConversionStore(db, crm);
    this.backfillInvites();
  }
  configure(config: ConversionConfig): void {
    if (this.activeSync)
      throw new CrmError('Aguardar sincronização antes de alterar a configuração');
    if (config.appId) opaque(config.appId, 'ID Base44');
    if (config.endpoint) {
      const endpoint = publicWebsite(config.endpoint);
      if (endpoint.search)
        throw new CrmError(
          'Endpoint não deve conter credenciais/parâmetros; autenticação apenas no backend',
        );
    }
    if (
      !['manual', 'on_demand'].includes(config.syncMode) ||
      config.authType !== 'hmac-sha256' ||
      typeof config.referenceSupported !== 'boolean' ||
      !/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(config.referenceParameter) ||
      config.referenceParameter.toLowerCase().match(/token|secret|password|phone|email/) ||
      !Number.isInteger(config.retentionDays) ||
      config.retentionDays < 30 ||
      config.retentionDays > 3650 ||
      typeof config.permissionEvidence !== 'string' ||
      config.permissionEvidence.length > 2000
    )
      throw new CrmError('Configuração de conversão inválida');
    if (
      (config.syncMode === 'on_demand' || config.referenceSupported) &&
      (!config.appId || !config.permissionEvidence.trim())
    )
      throw new CrmError(
        'Confirmar ID da aplicação e permissão/capacidade antes de ativar a integração ou referência',
      );
    this.store.atomic(() => this.store.saveConfig(config));
    this.changed();
  }
  allowedUrl(conversationId: string, body: string): string | null {
    const found = urls(body);
    const official = this.knowledge().signupUrl;
    if (found.length !== 1) return official;
    if (found[0] === official) return official;
    const r = this.store.db
      .prepare(
        'SELECT trackedUrl FROM conversion_references WHERE conversationId=? AND trackedUrl=?',
      )
      .get(conversationId, found[0]);
    return r ? String(r.trackedUrl) : official;
  }
  prepareLink(conversationId: string, body: string): string {
    const k = this.knowledge();
    if (!k.signupUrl) return body;
    const found = urls(body);
    if (found.length !== 1) return body;
    const allowed = this.allowedUrl(conversationId, body);
    if (found[0] !== allowed) throw new CrmError('URL de convite não registado para esta conversa');
    const c = this.store.db
      .prepare('SELECT companyId FROM messaging_conversations WHERE id=?')
      .get(conversationId);
    if (!c?.companyId) throw new CrmError('Associar convite à oportunidade CRM');
    const config = this.store.config();
    const ref = randomUUID();
    const link = new URL(k.signupUrl);
    if (config.referenceSupported) link.searchParams.set(config.referenceParameter, ref);
    const tracked = config.referenceSupported ? link.toString() : k.signupUrl;
    this.store.db
      .prepare('INSERT INTO conversion_references VALUES (?,?,?,?,?,?)')
      .run(ref, String(c.companyId), conversationId, k.signupUrl, tracked, now());
    return body.replace(found[0], tracked);
  }
  invitationDraft(d: MessagingDraft): void {
    if (d.kind !== 'invitation') return;
    const c = this.store.db
      .prepare('SELECT * FROM messaging_conversations WHERE id=?')
      .get(d.conversationId);
    if (!c?.companyId) return;
    const link = urls(d.body)[0];
    if (!link) return;
    let r = this.store.db
      .prepare(
        'SELECT * FROM conversion_references WHERE conversationId=? AND trackedUrl=? ORDER BY rowid DESC LIMIT 1',
      )
      .get(d.conversationId, link);
    if (!r) {
      const id = randomUUID();
      this.store.db
        .prepare('INSERT INTO conversion_references VALUES (?,?,?,?,?,?)')
        .run(id, String(c.companyId), d.conversationId, link, link, d.createdAt);
      r = { id, officialUrl: link };
    }
    this.store.db
      .prepare('INSERT OR IGNORE INTO conversion_invites VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        String(c.companyId),
        d.conversationId,
        d.id,
        String(r.id),
        d.employeeId,
        d.createdAt,
        null,
        String(r.officialUrl),
        link,
        c.simulated ? 1 : 0,
        null,
      );
  }
  invitationConfirmed(
    draftId: string,
    deliveryId: string,
    proofOrigin?: 'provider' | 'manual',
  ): void {
    const d = this.store.db
      .prepare('SELECT * FROM messaging_drafts WHERE id=?')
      .get(draftId) as unknown as MessagingDraft | undefined;
    if (!d || d.kind !== 'invitation') return;
    this.invitationDraft(d);
    const delivery = this.store.db
      .prepare('SELECT * FROM messaging_deliveries WHERE id=? AND draftId=?')
      .get(deliveryId, draftId);
    if (!delivery || delivery.status !== 'confirmed') return;
    const invite = this.store.db
      .prepare('SELECT * FROM conversion_invites WHERE draftId=?')
      .get(draftId);
    if (!invite) return;
    const manual = !!this.store.db
      .prepare(
        "SELECT 1 FROM messaging_audit WHERE conversationId=? AND action='delivery_reconciled' AND detail LIKE 'confirmed:%' AND createdAt<=? ORDER BY id DESC LIMIT 1",
      )
      .get(d.conversationId, String(delivery.updatedAt));
    const origin = invite.simulated
      ? 'simulated'
      : proofOrigin
        ? proofOrigin === 'manual'
          ? 'manual'
          : 'integration'
        : manual
          ? 'manual'
          : 'integration';
    this.store.db
      .prepare(
        'UPDATE conversion_invites SET confirmedAt=?,confirmationOrigin=? WHERE draftId=? AND confirmedAt IS NULL',
      )
      .run(String(delivery.updatedAt), origin, draftId);
    this.store.db
      .prepare(
        'INSERT OR IGNORE INTO conversion_followups(id,inviteId,companyId,conversationId,createdAt) VALUES (?,?,?,?,?)',
      )
      .run(randomUUID(), String(invite.id), String(invite.companyId), d.conversationId, now());
    this.store.notice(
      'handoff:' + String(invite.id),
      String(invite.companyId),
      'ceo_handoff',
      `${invite.simulated ? '[SIMULADO] ' : ''}NOVO CLIENTE INTERESSADO — ATENDIMENTO DO CEO`,
      d.conversationId,
    );
  }
  private backfillInvites(): void {
    this.store.atomic(() => {
      for (const row of this.store.db
        .prepare(
          "SELECT d.* FROM messaging_drafts d JOIN messaging_conversations c ON c.id=d.conversationId WHERE d.kind='invitation' AND c.companyId IS NOT NULL",
        )
        .all())
        this.invitationDraft(row as unknown as MessagingDraft);
      for (const row of this.store.db
        .prepare(
          "SELECT x.id,x.draftId FROM messaging_deliveries x JOIN messaging_drafts d ON d.id=x.draftId WHERE x.status='confirmed' AND d.kind='invitation'",
        )
        .all())
        this.invitationConfirmed(String(row.draftId), String(row.id));
    });
  }
  manual(companyId: string, fact: ConversionFact): { id: string; duplicate: boolean } {
    const company = this.store.crm.company(companyId);
    const c = this.store.config();
    if (fact.appId !== (c.appId || 'manual-agexa'))
      throw new CrmError('O evento manual deve usar o ID configurado ou manual-agexa');
    const out = this.store.ingest(fact, 'manual', company.id);
    this.store.alertTrials();
    this.changed();
    return out;
  }
  async sync(): Promise<{ received: number; duplicates: number }> {
    if (this.activeSync) throw new CrmError('Sincronização já em curso', 409);
    const started = this.store.db
      .prepare('SELECT count(*) n FROM conversion_sync_runs WHERE startedAt>?')
      .get(new Date(Date.now() - 3600000).toISOString());
    if (Number(started?.n) >= 30) throw new CrmError('Limite de 30 sincronizações por hora', 429);
    const config = this.store.config(),
      cursor = this.store.integration().cursor;
    const run = randomUUID();
    this.store.db
      .prepare('INSERT INTO conversion_sync_runs VALUES (?,?,?,?,?,?)')
      .run(run, 'running', now(), null, null, null);
    const controller = new AbortController();
    this.activeSync = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    this.changed();
    try {
      const feed = await Promise.race([
        this.connector.pull(config, cursor, this.secret(), signal),
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new CrmError('Sincronização interrompida/timeout')),
            { once: true },
          );
        }),
      ]);
      signal.throwIfAborted();
      if (this.closed) throw new CrmError('Sincronização interrompida');
      let duplicates = 0;
      this.store.atomic(() => {
        for (const fact of feed.events)
          if (
            this.store.ingest(fact, this.connector.simulated ? 'simulated' : 'integration')
              .duplicate
          )
            duplicates++;
        this.store.db
          .prepare(
            "UPDATE conversion_config SET cursor=?,lastSync=?,error=NULL,status=? WHERE id='main'",
          )
          .run(
            feed.nextCursor ?? cursor,
            now(),
            this.connector.simulated ? 'simulated' : 'authenticated_feed',
          );
        this.store.db
          .prepare(
            "UPDATE conversion_sync_runs SET status='completed',finishedAt=?,nonce=? WHERE id=?",
          )
          .run(now(), feed.nonce, run);
        this.store.alertTrials();
      });
      return { received: feed.events.length, duplicates };
    } catch (error) {
      if (!this.closed) {
        this.store.db
          .prepare("UPDATE conversion_sync_runs SET status='error',finishedAt=?,error=? WHERE id=?")
          .run(now(), 'Falha de autenticação, transporte ou contrato; cursor preservado.', run);
        this.store.db
          .prepare("UPDATE conversion_config SET error=?,status='error' WHERE id='main'")
          .run('Sincronização falhou; consultar configuração, permissões, rede e contrato.');
        this.store.audit('sync_failed', 'Sem avanço de cursor; nenhum envio de mensagens.');
      }
      throw error;
    } finally {
      this.activeSync = null;
      if (!this.closed) this.changed();
    }
  }
  resolve(id: string, companyId: string, evidence: string, alias = false): void {
    this.store.resolve(id, companyId, evidence, alias);
    this.store.alertTrials();
    this.changed();
  }
  rejectEvent(id: string, evidence: string): void {
    if (!evidence.trim() || evidence.length > 1000)
      throw new CrmError('Motivo independente obrigatório');
    const row = this.store.db
      .prepare('SELECT companyId,status FROM conversion_events WHERE id=?')
      .get(id);
    if (!row || row.status !== 'pending')
      throw new CrmError('Só eventos pendentes podem ser rejeitados');
    this.store.atomic(() => {
      this.store.db
        .prepare("UPDATE conversion_events SET status='rejected',reason=? WHERE id=?")
        .run(evidence, id);
      this.store.audit('event_rejected', evidence, row.companyId ? String(row.companyId) : null);
    });
    this.changed();
  }
  followup(
    id: string,
    notes: string,
    followupAt: string | null,
    closedReason: string | null,
  ): void {
    const row = this.store.db.prepare('SELECT * FROM conversion_followups WHERE id=?').get(id);
    if (!row) throw new CrmError('Acompanhamento inexistente', 404);
    if (
      notes.length > 4000 ||
      (closedReason !== null && (!closedReason.trim() || closedReason.length > 1000))
    )
      throw new CrmError('Notas/motivo inválidos');
    if (followupAt) isoDate(followupAt);
    this.store.atomic(() => {
      if (closedReason) {
        if (
          this.store.crm.company(String(row.companyId)).stage === 'paying' ||
          this.store.db
            .prepare('SELECT 1 FROM conversion_payments WHERE companyId=?')
            .get(String(row.companyId))
        )
          throw new CrmError('Cliente pagante não é uma oportunidade não convertida');
        this.store.crm.move(String(row.companyId), 'lost');
      }
      this.store.db
        .prepare('UPDATE conversion_followups SET notes=?,followupAt=?,closedReason=? WHERE id=?')
        .run(notes, followupAt, closedReason, id);
      this.store.audit(
        'ceo_followup_updated',
        closedReason
          ? 'Oportunidade encerrada: ' + closedReason
          : 'Notas/data de acompanhamento atualizadas',
        String(row.companyId),
      );
    });
    this.changed();
  }
  handoffDetail(id: string): Record<string, unknown> {
    const f = this.store.db.prepare('SELECT * FROM conversion_followups WHERE id=?').get(id);
    if (!f) throw new CrmError('Acompanhamento inexistente', 404);
    const invite = this.store.db
      .prepare('SELECT * FROM conversion_invites WHERE id=?')
      .get(String(f.inviteId));
    const company = this.store.crm.company(String(f.companyId));
    const received = this.store.db
      .prepare(
        "SELECT id,body,createdAt FROM messaging_messages WHERE conversationId=? AND direction='inbound' ORDER BY rowid DESC LIMIT 10",
      )
      .all(String(f.conversationId));
    const sent = this.store.db
      .prepare(
        "SELECT body,createdAt FROM messaging_messages WHERE conversationId=? AND direction='outbound' AND status='confirmed' ORDER BY rowid DESC LIMIT 5",
      )
      .all(String(f.conversationId));
    return {
      followup: f,
      invite,
      company,
      lastReceived: received[0] ?? null,
      received,
      confirmedArguments: sent,
      observedObjections: this.store.db
        .prepare(
          'SELECT m.id,m.body,o.evidence FROM conversion_objections o JOIN messaging_messages m ON m.id=o.messageId WHERE o.conversationId=?',
        )
        .all(String(f.conversationId)),
      account:
        this.store.db
          .prepare('SELECT * FROM conversion_accounts WHERE companyId=?')
          .get(company.id) ?? null,
      nextAction: f.closedReason
        ? 'Encerrada com motivo'
        : 'CEO confirma necessidades, cadastro e teste; sem contacto dos agentes por iniciativa própria.',
    };
  }
  objection(messageId: string, evidence: string): void {
    if (!evidence.trim() || evidence.length > 1000)
      throw new CrmError('Evidência da objeção obrigatória');
    const m = this.store.db
      .prepare("SELECT conversationId FROM messaging_messages WHERE id=? AND direction='inbound'")
      .get(messageId);
    if (!m) throw new CrmError('Selecionar uma mensagem recebida real/identificada como teste');
    this.store.db
      .prepare('INSERT OR IGNORE INTO conversion_objections VALUES (?,?,?,?)')
      .run(messageId, String(m.conversationId), evidence, now());
    this.changed();
  }
  noticeSeen(id: string): void {
    this.store.db.prepare('UPDATE conversion_notices SET seenAt=? WHERE id=?').run(now(), id);
    this.changed();
  }
  snapshot(): ConversionSnapshot {
    const integration = this.store.integration();
    return {
      config: this.store.config(),
      integration: {
        ...integration,
        secretConfigured: this.secret().length >= 32,
        capabilities: [
          'Feed mínimo assinado; ativação depende da aplicação e do plano',
          'Confirmação manual auditada sempre disponível',
          'Sem acesso externo a service role, contas, pagamentos ou credenciais administrativas',
        ],
      },
      metrics: this.store.metrics(),
      notices: this.store.notices(),
      trials: this.store.trials(),
      accounts: this.store.db
        .prepare('SELECT * FROM conversion_accounts ORDER BY rowid DESC LIMIT 200')
        .all() as unknown as ConversionSnapshot['accounts'],
      invites: this.store.invites(),
      followups: this.store.db
        .prepare('SELECT * FROM conversion_followups ORDER BY rowid DESC LIMIT 100')
        .all() as unknown as ConversionSnapshot['followups'],
      validations: this.store.db
        .prepare('SELECT * FROM conversion_validations ORDER BY rowid DESC LIMIT 30')
        .all() as unknown as ConversionSnapshot['validations'],
    };
  }
  validation(
    taskId: string | null,
    mode: string,
    status: string,
    detail: string,
    model: string | null = null,
    durationMs: number | null = null,
  ): void {
    this.store.db
      .prepare(
        'INSERT INTO conversion_validations VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(taskId) DO UPDATE SET mode=excluded.mode,status=excluded.status,model=excluded.model,durationMs=excluded.durationMs,detail=excluded.detail',
      )
      .run(randomUUID(), taskId, mode, status, model, durationMs, now(), detail.slice(0, 2000));
  }
  completeValidation(
    task: SalesTask,
    result: Record<string, unknown> | null,
    error: string | null,
  ): void {
    if (!task.input.conversionValidation) return;
    this.validation(
      task.id,
      result?.executionMode === 'test'
        ? 'simulated'
        : result?.executionMode === 'ollama'
          ? 'real'
          : 'unavailable',
      error ? 'failed' : 'contract_pass',
      error ??
        'Resposta do adaptador recebida e JSON validado; não implica validação de qualidade comercial.',
      typeof result?.model === 'string' ? result.model : null,
      typeof result?.durationMs === 'number' ? result.durationMs : null,
    );
  }
  close(): void {
    this.closed = true;
    this.activeSync?.abort();
  }
}
