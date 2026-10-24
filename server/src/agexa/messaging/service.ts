import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import * as QRCode from 'qrcode';

import type { SalesTask } from '../../../../core/src/agexa.js';
import type { AgexaKnowledge } from '../../../../core/src/intelligence.js';
import type {
  ChannelMode,
  MessagingConnection,
  MessagingConversation,
  MessagingDraft,
  MessagingProviderId,
  MessagingSnapshot,
} from '../../../../core/src/messaging.js';
import { CrmError } from '../crm/error.js';
import { modelCompany } from '../crm/operations.js';
import type { CrmStore } from '../crm/store.js';
import { validateOperationalResult } from '../prompts.js';
import { WhatsAppWebExperimentalProvider } from './experimental.js';
import { MockWhatsAppProvider } from './mock.js';
import type { MessagingProvider, ProviderEvent, SendResult } from './provider.js';
import { NO_CAPABILITIES, WhatsAppCloudApiProvider } from './provider.js';
import { MessagingStore, timestamp } from './store.js';
export interface MessagingHost {
  crm: CrmStore;
  knowledge: () => AgexaKnowledge;
  suspended: () => boolean;
  changed: () => void;
  cancel: (conversationId?: string) => void;
  prepareInvitation?: (id: string, body: string) => string;
  allowedInvitationUrl?: (id: string, body: string) => string | null;
  invitationDraft?: (draft: MessagingDraft) => void;
  invitationConfirmed?: (
    draftId: string,
    deliveryId: string,
    origin?: 'provider' | 'manual',
  ) => void;
}
type Config = {
  provider: MessagingProviderId;
  mode: ChannelMode;
  suspended: boolean;
  experimentalConfirmed: boolean;
  accounts?: Partial<Record<MessagingProviderId, string>>;
};
export class MessagingService {
  readonly store: MessagingStore;
  private config: Config = {
    provider: 'none',
    mode: 'assisted',
    suspended: true,
    experimentalConfirmed: false,
  };
  private provider: MessagingProvider | null = null;
  private state: MessagingConnection['status'] = 'disabled';
  private error: string | null = null;
  private account: string | null = null;
  private qr: { value: string; expires: number } | null = null;
  private closed = false;
  private connecting = false;
  private accountMismatch = false;
  private readonly sending = new Set<string>();
  private readonly earlyReceipts = new Set<string>();
  constructor(
    db: DatabaseSync,
    readonly directory: string,
    private readonly host: MessagingHost,
    private readonly injected?: MessagingProvider,
  ) {
    this.store = new MessagingStore(db);
    const row = db.prepare("SELECT config FROM messaging_connections WHERE id='main'").get();
    if (row) {
      this.config = JSON.parse(String(row.config));
      this.state = this.config.provider === 'none' ? 'disabled' : 'disconnected';
    }
  }
  private save(): void {
    this.store.db
      .prepare(
        "INSERT INTO messaging_connections VALUES ('main',?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,updatedAt=excluded.updatedAt",
      )
      .run(JSON.stringify(this.config), timestamp());
  }
  private changed(): void {
    if (!this.closed) this.host.changed();
  }
  snapshot(): MessagingSnapshot {
    const count = (sql: string): number => Number(this.store.db.prepare(sql).get()?.n ?? 0);
    return {
      connection: {
        provider: this.config.provider,
        status: this.state,
        mode: this.config.mode,
        suspended: this.config.suspended,
        account: this.account,
        simulated: this.config.provider === 'mock',
        capabilities: this.provider?.capabilities ?? NO_CAPABILITIES,
        limitations: this.provider?.limitations ?? [
          'Canal desligado. Configurar e ligar explicitamente; nenhum envio automático.',
        ],
        error: this.error,
        qrAvailable: !!this.qr && this.qr.expires > Date.now(),
      },
      notifications: this.store.audits(),
      metrics: {
        realConversations: count(
          'SELECT count(*) n FROM messaging_conversations WHERE simulated=0',
        ),
        simulatedConversations: count(
          'SELECT count(*) n FROM messaging_conversations WHERE simulated=1',
        ),
        confirmedRealSends: count(
          "SELECT count(*) n FROM messaging_messages WHERE direction='outbound' AND simulated=0 AND status='confirmed'",
        ),
        confirmedSimulatedSends: count(
          "SELECT count(*) n FROM messaging_messages WHERE direction='outbound' AND simulated=1 AND status='confirmed'",
        ),
        awaitingApproval: count("SELECT count(*) n FROM messaging_drafts WHERE status='proposed'"),
        reconciliation: count(
          "SELECT count(*) n FROM messaging_deliveries WHERE status='reconciliation'",
        ),
      },
    };
  }
  async configure(provider: MessagingProviderId, experimentalConfirmed = false): Promise<void> {
    if (!['none', 'mock', 'web_experimental', 'cloud_api'].includes(provider))
      throw new CrmError('Provider inválido');
    if (provider === 'mock' && !this.injected && process.env.AGEXA_MESSAGING_TEST_MODE !== '1')
      throw new CrmError('Mock permitido apenas em testes isolados');
    if (provider === 'web_experimental' && !experimentalConfirmed)
      throw new CrmError('Confirmar cliente não oficial e utilização de número de testes');
    if (this.sending.size || this.connecting)
      throw new CrmError('Aguardar conexão/envio antes de alterar o canal', 409);
    await this.disconnect();
    this.config = {
      ...this.config,
      provider,
      experimentalConfirmed,
      suspended: true,
      mode: 'assisted',
    };
    this.save();
    this.state = provider === 'none' ? 'disabled' : 'disconnected';
    this.store.audit('channel_configured', `${provider}; desligado e suspenso`);
    this.changed();
  }
  async connect(confirmed = false): Promise<void> {
    if (this.provider) throw new CrmError('Desligar antes de reconectar', 409);
    if (this.config.provider === 'none') throw new CrmError('Configurar um provider');
    if (
      this.config.provider === 'web_experimental' &&
      (!confirmed || !this.config.experimentalConfirmed)
    )
      throw new CrmError('Confirmar ligação de número de testes ao cliente não oficial');
    if (
      this.config.provider === 'mock' &&
      !this.injected &&
      process.env.AGEXA_MESSAGING_TEST_MODE !== '1'
    )
      throw new CrmError('Mock exclusivo de testes');
    const session = path.resolve(this.directory, 'messaging-auth');
    // No auth data may be placed under a Git checkout, even with AGEXA_DATA_DIR misconfigured.
    if (this.config.provider === 'web_experimental') {
      let cursor = fs.realpathSync(this.directory);
      while (true) {
        if (
          fs.existsSync(path.join(cursor, '.git', 'HEAD')) ||
          (fs.existsSync(path.join(cursor, '.git')) &&
            fs.statSync(path.join(cursor, '.git')).isFile())
        )
          throw new CrmError('Sessão WhatsApp exige AGEXA_DATA_DIR fora de qualquer checkout Git');
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
      if (fs.existsSync(session) && fs.lstatSync(session).isSymbolicLink())
        throw new CrmError('Diretório de sessão não pode ser symlink');
    }
    const provider =
      this.injected?.id === this.config.provider
        ? this.injected
        : this.config.provider === 'mock'
          ? (this.injected ?? new MockWhatsAppProvider())
          : this.config.provider === 'web_experimental'
            ? new WhatsAppWebExperimentalProvider(session)
            : new WhatsAppCloudApiProvider();
    if (provider.id !== this.config.provider)
      throw new CrmError('Provider não corresponde ao canal');
    this.provider = provider;
    this.closed = false;
    this.accountMismatch = false;
    this.state = 'connecting';
    this.error = null;
    this.connecting = true;
    provider.on('event', (e) => {
      if (!this.closed && this.provider === provider) {
        try {
          this.event(e);
        } catch {
          this.error = 'Evento do provider recusado; consultar auditoria.';
          this.store.audit('provider_event_error', 'Evento inválido ou conflito persistente');
          this.changed();
        }
      }
    });
    this.changed();
    void provider
      .connect()
      .catch(() => {
        if (this.provider === provider && !this.closed) {
          this.state = 'error';
          this.error =
            'Não foi possível ligar. Verificar navegador instalado, rede autorizada e sessão; nenhum envio realizado.';
          this.qr = null;
          this.store.audit('connection_error', this.error);
          this.changed();
        }
      })
      .finally(() => {
        this.connecting = false;
      });
  }
  async disconnect(revoke = false): Promise<void> {
    const current = this.provider;
    this.provider = null;
    this.qr = null;
    this.account = null;
    this.state = 'disconnected';
    current?.removeAllListeners();
    try {
      if (current) await current.disconnect(revoke);
      else if (revoke) {
        const session = path.resolve(this.directory, 'messaging-auth');
        if (fs.existsSync(session) && fs.lstatSync(session).isSymbolicLink())
          throw new CrmError('Sessão symlink recusada');
        fs.rmSync(path.join(session, 'session-agexa-test'), { recursive: true, force: true });
      }
    } catch {
      this.error =
        'Falha ao desligar/revogar; confirme também nos dispositivos associados do telefone.';
      this.store.audit('disconnect_error', this.error);
      this.changed();
      throw new CrmError(this.error);
    }
    this.store.audit(
      revoke ? 'session_revoked' : 'channel_disconnected',
      revoke
        ? 'Sessão local removida; verificar dispositivos no telefone.'
        : 'Sessão local conservada; reconexão exige ação administrativa.',
    );
    this.changed();
  }
  async qrImage(): Promise<{ image: string; expiresAt: string }> {
    if (!this.qr || this.qr.expires <= Date.now())
      throw new CrmError('QR expirado ou indisponível', 404);
    return {
      image: await QRCode.toDataURL(this.qr.value, { width: 280, margin: 2 }),
      expiresAt: new Date(this.qr.expires).toISOString(),
    };
  }
  setMode(mode: ChannelMode): void {
    if (mode === 'automatic')
      throw new CrmError(
        'Modo automático bloqueado: nenhum provider ativo possui transporte, políticas e deteção humana validados para automação.',
      );
    if (!['manual', 'assisted'].includes(mode)) throw new CrmError('Modo inválido');
    this.config.mode = mode;
    this.save();
    this.store.audit('mode_changed', mode);
    this.changed();
  }
  suspend(value: boolean): void {
    this.config.suspended = value;
    this.save();
    if (value) this.host.cancel();
    this.store.audit(
      value ? 'channel_suspended' : 'channel_resumed',
      'Ação administrativa; sem envio implícito.',
    );
    this.changed();
  }
  private event(event: ProviderEvent): void {
    if (this.accountMismatch && event.type !== 'state') return;
    if (event.type === 'state') {
      this.state = event.status;
      if (event.account) {
        const previous = this.config.accounts?.[this.config.provider];
        if (previous && previous !== event.account) {
          this.accountMismatch = true;
          this.state = 'error';
          this.config.suspended = true;
          this.error =
            'Conta diferente da inbox existente. Utilizar um diretório de dados privado separado para outro número.';
          this.save();
          this.store.audit('account_mismatch', this.error);
          this.changed();
          return;
        }
        this.accountMismatch = false;
        this.account = event.account.slice(0, 100);
        this.config.accounts = { ...this.config.accounts, [this.config.provider]: this.account };
        this.save();
      }
      if (event.status !== 'qr') this.qr = null;
      this.store.audit('connection_state', event.status);
    }
    if (event.type === 'qr') {
      if (event.value.length > 10000) return;
      this.qr = { value: event.value, expires: Date.now() + 60000 };
      this.state = 'qr';
    }
    if (event.type === 'error') {
      this.error = event.code.slice(0, 200);
      this.state = 'error';
      this.qr = null;
      this.store.audit('provider_error', this.error);
    }
    if (event.type === 'message') {
      if (this.state !== 'connected') return;
      const received = this.store.receive(this.config.provider, this.provider!.simulated, event);
      if (
        received &&
        /(?:^stop\b|^parar\b|^cancelar\b|n[aã]o\s+(?:me\s+(?:contacte|envie|mande)|quero\s+(?:mais\s+)?(?:mensagens|contacto|receber\s+(?:o\s+)?link))|pare\s+de\s+(?:me\s+)?(?:contactar|enviar))/i.test(
          event.body.trim(),
        )
      ) {
        this.store.assign(
          received.conversation.id,
          'ceo',
          'Pedido explícito de não contacto',
          'opted_out',
        );
        this.host.cancel(received.conversation.id);
        const company = received.conversation.companyId;
        if (company)
          this.host.crm.consent(
            company,
            'whatsapp',
            'revoked',
            'Pedido de não contacto recebido no canal',
            'WhatsApp recebido',
          );
      }
    }
    if (event.type === 'receipt' && event.confirmed) {
      const row = this.store.db
        .prepare(
          'SELECT id FROM messaging_deliveries WHERE providerId=? AND conversationId IN (SELECT id FROM messaging_conversations WHERE provider=?)',
        )
        .get(event.id, this.config.provider);
      if (row) this.confirm(String(row.id));
      else if (this.sending.size && this.earlyReceipts.size < 100) this.earlyReceipts.add(event.id);
    }
    if (event.type === 'human') {
      const c = this.store.db
        .prepare('SELECT id FROM messaging_conversations WHERE provider=? AND remoteId=?')
        .get(this.config.provider, event.remoteId);
      if (
        c &&
        !this.store.db
          .prepare('SELECT 1 FROM messaging_messages WHERE provider=? AND providerId=?')
          .get(this.config.provider, event.id)
      ) {
        const id = String(c.id);
        this.store.db
          .prepare('INSERT INTO messaging_messages VALUES (?,?,?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            id,
            this.config.provider,
            event.id,
            'outbound',
            event.body.slice(0, 6000),
            'observed',
            this.provider!.simulated ? 1 : 0,
            timestamp(),
          );
        this.store.assign(id, 'ceo', 'Intervenção humana detetada pelo provider');
        this.host.cancel(id);
      }
    }
    this.changed();
  }
  link(id: string, companyId: string): void {
    const c = this.store.conversation(id);
    const company = this.host.crm.company(companyId);
    const digits = company.businessContact.replace(/\D/g, '');
    if (company.contactChannel !== 'whatsapp' || digits !== c.remoteId.split('@')[0])
      throw new CrmError(
        'Confirmar no CRM o mesmo contacto empresarial WhatsApp; sem fusão automática',
      );
    if (c.simulated !== (company.recordMode === 'simulated'))
      throw new CrmError('Não associar dados simulados a empresas reais');
    this.store.atomic(() => {
      this.store.db
        .prepare('UPDATE messaging_conversations SET companyId=? WHERE id=?')
        .run(companyId, id);
      this.store.audit('company_linked', 'Associação explícita pelo CEO ao CRM', id);
    });
    this.changed();
  }
  note(id: string, notes: string): void {
    if (notes.length > 4000) throw new CrmError('Nota demasiado longa');
    this.store.conversation(id);
    this.store.db
      .prepare('UPDATE messaging_conversations SET notes=?,updatedAt=? WHERE id=?')
      .run(notes, timestamp(), id);
    this.store.audit('note_saved', 'Nota interna atualizada', id);
    this.changed();
  }
  assign(id: string, owner: MessagingConversation['owner']): void {
    if (
      !['ceo', 'nexus', 'hunter', 'atlas', 'maya', 'luna', 'victor', 'sophia', 'orion'].includes(
        owner,
      )
    )
      throw new CrmError('Responsável inválido');
    const c = this.store.conversation(id);
    if (c.state === 'opted_out' || c.state === 'reconciliation')
      throw new CrmError('Resolver não contacto/reconciliação antes de alterar responsabilidade');
    this.store.assign(
      id,
      owner,
      'Atribuição explícita pelo CEO',
      owner === 'ceo' ? 'human' : 'open',
    );
    if (owner === 'ceo') this.host.cancel(id);
    this.changed();
  }
  acceptance(
    id: string,
    messageId: string,
    kind: 'interest' | 'link_acceptance',
    evidence: string,
  ): void {
    if (!evidence.trim() || evidence.length > 1000)
      throw new CrmError('Registar evidência da declaração do cliente');
    this.store.conversation(id);
    const msg = this.store.db
      .prepare(
        "SELECT id FROM messaging_messages WHERE id=? AND conversationId=? AND direction='inbound'",
      )
      .get(messageId, id);
    if (!msg) throw new CrmError('Selecionar mensagem recebida que comprova a declaração');
    if (kind === 'link_acceptance' && !this.store.conversation(id).interestedMessageId)
      throw new CrmError('Confirmar interesse primeiro');
    this.store.db
      .prepare(
        `UPDATE messaging_conversations SET ${kind === 'interest' ? 'interestedMessageId' : 'acceptedMessageId'}=?,updatedAt=? WHERE id=?`,
      )
      .run(messageId, timestamp(), id);
    this.store.audit(kind, evidence, id);
    this.changed();
  }
  private content(body: string, kind: MessagingDraft['kind'], id: string): void {
    if (!body.trim() || body.length > 6000)
      throw new CrmError('Mensagem deve conter 1–6000 caracteres');
    const baseKnowledge = this.host.knowledge();
    const knowledge =
      kind === 'invitation'
        ? {
            ...baseKnowledge,
            signupUrl: this.host.allowedInvitationUrl?.(id, body) ?? baseKnowledge.signupUrl,
          }
        : baseKnowledge;
    try {
      validateOperationalResult(
        { summary: 'Rascunho interno', draft: body, observations: [], nextActions: [] },
        { stage: null } as SalesTask,
        knowledge,
      );
    } catch (e) {
      throw new CrmError(e instanceof Error ? e.message : 'Conteúdo comercial recusado');
    }
    if (knowledge.signupUrl && body.includes(knowledge.signupUrl) && kind !== 'invitation')
      throw new CrmError('Usar convite Sophia para o link, com interesse e aceitação registados');
    if (kind === 'invitation') {
      const c = this.store.conversation(id);
      if (
        !knowledge.signupUrl ||
        !knowledge.trialAvailable ||
        knowledge.trialDays !== 7 ||
        !c.interestedMessageId ||
        !c.acceptedMessageId
      )
        throw new CrmError(
          'Convite exige URL/7 dias confirmados, interesse e aceitação de receber o link',
        );
      if (!body.includes(knowledge.signupUrl))
        throw new CrmError('Convite deve conter o link oficial confirmado');
    }
  }
  draft(id: string, body: string, kind: MessagingDraft['kind'] = 'reply'): MessagingDraft {
    const c = this.store.conversation(id);
    if (c.state === 'opted_out') throw new CrmError('Cliente pediu não contacto');
    this.content(body, kind, id);
    const d = this.store.atomic(() => {
      const prepared =
        kind === 'invitation' ? (this.host.prepareInvitation?.(id, body) ?? body) : body;
      this.content(prepared, kind, id);
      const d = this.store.addDraft(id, prepared, 'ceo', 'manual', kind);
      if (kind === 'invitation') this.host.invitationDraft?.(d);
      return d;
    });
    this.changed();
    return d;
  }
  private eligible(id: string): MessagingConversation {
    const c = this.store.conversation(id);
    if (c.state === 'opted_out' || c.state === 'reconciliation')
      throw new CrmError('Conversa bloqueada para envio');
    if (!c.companyId) throw new CrmError('Associar empresa e consentimento WhatsApp no CRM');
    const company = this.host.crm.company(c.companyId);
    if (
      company.contactChannel !== 'whatsapp' ||
      company.businessContact.replace(/\D/g, '') !== c.remoteId.split('@')[0] ||
      !this.host.crm.eligibility(company.id, 'whatsapp').allowed
    )
      throw new CrmError('Sem consentimento WhatsApp ativo para este contacto empresarial');
    return c;
  }
  review(id: string, decision: 'approved' | 'rejected'): void {
    const d = this.store.draft(id);
    if (d.status !== 'proposed') throw new CrmError('Só rascunhos pendentes podem ser revistos');
    if (decision === 'approved') {
      this.eligible(d.conversationId);
      this.content(d.body, d.kind, d.conversationId);
      if (d.sourceMessageId !== this.store.latestInbound(d.conversationId).id)
        throw new CrmError('Nova mensagem recebida: criar versão atualizada');
    }
    this.store.atomic(() => {
      this.store.db.prepare('UPDATE messaging_drafts SET status=? WHERE id=?').run(decision, id);
      this.store.db
        .prepare('INSERT INTO messaging_approvals VALUES (?,?,?,?,?)')
        .run(randomUUID(), id, decision, 'ceo', timestamp());
      this.store.audit(
        'draft_' + decision,
        `Versão ${d.version} revista pelo CEO`,
        d.conversationId,
      );
    });
    this.changed();
  }
  async send(id: string): Promise<void> {
    const d = this.store.draft(id);
    const c = this.eligible(d.conversationId);
    if (this.config.suspended || this.host.suspended())
      throw new CrmError('Operações/canal suspensos');
    if (
      c.provider !== this.config.provider ||
      !this.provider?.capabilities.send ||
      this.state !== 'connected'
    )
      throw new CrmError('Canal correspondente não está ligado');
    if (d.status !== 'approved')
      throw new CrmError('Envio exige aprovação humana individual da versão exata');
    if (c.owner === 'ceo' && d.employeeId !== 'ceo')
      throw new CrmError('Conversa entregue ao CEO: respostas dos agentes bloqueadas');
    if (d.mode === 'test' && !c.simulated)
      throw new CrmError('Nunca enviar conteúdo de modelo de teste a conversa real');
    if (d.sourceMessageId !== this.store.latestInbound(c.id).id)
      throw new CrmError('Rascunho desatualizado após nova mensagem');
    this.content(d.body, d.kind, c.id);
    if (c.simulated !== this.provider.simulated)
      throw new CrmError('Mistura de dados reais e simulados recusada');
    const delivery = randomUUID(),
      message = randomUUID();
    this.store.atomic(() => {
      if (
        this.store.db
          .prepare(
            "SELECT 1 FROM messaging_deliveries WHERE conversationId=? AND status IN ('sending','pending','reconciliation')",
          )
          .get(c.id)
      )
        throw new CrmError('Envio já em curso ou a reconciliar', 409);
      this.store.db
        .prepare('INSERT INTO messaging_messages VALUES (?,?,?,?,?,?,?,?,?)')
        .run(
          message,
          c.id,
          c.provider,
          null,
          'outbound',
          d.body,
          'sending',
          c.simulated ? 1 : 0,
          timestamp(),
        );
      this.store.db
        .prepare('INSERT INTO messaging_deliveries VALUES (?,?,?,?,?,?,?,?)')
        .run(delivery, c.id, d.id, message, 'sending', null, timestamp(), timestamp());
      this.store.db.prepare("UPDATE messaging_drafts SET status='sending' WHERE id=?").run(d.id);
      this.store.audit(
        'send_started',
        `CEO autorizou versão ${d.version}; aguarda confirmação`,
        c.id,
      );
    });
    this.sending.add(c.id);
    this.changed();
    const provider = this.provider;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race<SendResult>([
        provider.send(c.remoteId, d.body),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('Confirmação de envio não recebida a tempo')),
            20000,
          );
        }),
      ]);
      if (this.closed) return;
      if (!result.id || result.id.length > 300) throw Error('Identificador de envio inválido');
      this.store.atomic(() => {
        this.store.db
          .prepare("UPDATE messaging_messages SET providerId=?,status='pending' WHERE id=?")
          .run(result.id, message);
        this.store.db
          .prepare(
            "UPDATE messaging_deliveries SET providerId=?,status='pending',updatedAt=? WHERE id=?",
          )
          .run(result.id, timestamp(), delivery);
      });
      if (result.confirmation === 'confirmed' || this.earlyReceipts.delete(result.id))
        this.confirm(delivery);
      else
        this.store.audit(
          'send_pending',
          'Provider devolveu identificador, sem confirmação de aceitação; não repetir envio.',
          c.id,
        );
    } catch {
      if (!this.closed)
        this.uncertain(
          delivery,
          'Falha ou timeout após tentativa; pode ter sido enviado. Reconciliar manualmente, sem retry.',
        );
    } finally {
      if (timer) clearTimeout(timer);
      this.sending.delete(c.id);
      if (!this.sending.size) this.earlyReceipts.clear();
      this.changed();
    }
  }
  private uncertain(id: string, reason: string): void {
    const d = this.store.db.prepare('SELECT * FROM messaging_deliveries WHERE id=?').get(id);
    if (!d) return;
    this.store.atomic(() => {
      this.store.db
        .prepare("UPDATE messaging_deliveries SET status='reconciliation',updatedAt=? WHERE id=?")
        .run(timestamp(), id);
      this.store.db
        .prepare("UPDATE messaging_messages SET status='reconciliation' WHERE id=?")
        .run(String(d.messageId));
      this.store.db
        .prepare("UPDATE messaging_drafts SET status='reconciliation' WHERE id=?")
        .run(String(d.draftId));
      this.store.assign(String(d.conversationId), 'ceo', reason, 'reconciliation');
    });
  }
  private confirm(id: string, proofOrigin: 'provider' | 'manual' = 'provider'): void {
    const delivery = this.store.db.prepare('SELECT * FROM messaging_deliveries WHERE id=?').get(id);
    if (!delivery || delivery.status === 'confirmed' || delivery.status === 'not_sent') return;
    this.store.atomic(() => {
      this.store.db
        .prepare("UPDATE messaging_deliveries SET status='confirmed',updatedAt=? WHERE id=?")
        .run(timestamp(), id);
      this.store.db
        .prepare("UPDATE messaging_messages SET status='confirmed' WHERE id=?")
        .run(String(delivery.messageId));
      this.store.db
        .prepare("UPDATE messaging_drafts SET status='sent' WHERE id=?")
        .run(String(delivery.draftId));
      const c = this.store.conversation(String(delivery.conversationId));
      const draft = this.store.draft(String(delivery.draftId));
      this.store.audit(
        'send_confirmed',
        c.simulated
          ? 'Confirmação SIMULADA do provider de teste.'
          : 'Provider confirmou aceitação da mensagem; não implica leitura.',
        c.id,
      );
      if (draft.kind !== 'invitation' && c.state === 'reconciliation')
        this.store.assign(c.id, 'ceo', 'Envio confirmado após reconciliação; atendimento humano.');
      if (draft.kind === 'invitation') {
        this.host.invitationConfirmed?.(draft.id, id, proofOrigin);
        this.store.assign(c.id, 'ceo', 'Link confirmado: respostas dos agentes bloqueadas.');
        this.host.cancel(c.id);
        if (c.companyId) {
          this.host.crm.activity(
            'whatsapp_link_confirmed',
            c.simulated
              ? 'Envio simulado; não é conversa real.'
              : 'Envio confirmado pelo provider WhatsApp',
            c.companyId,
            null,
            'sophia',
          );
          if (!c.simulated) {
            this.host.crm.recordMessagingHandoff(
              c.companyId,
              `WhatsApp: conversa ${c.id}; entrega ${id}; confirmação do canal ou reconciliação auditada.`,
            );
            this.host.crm.handoff(c.companyId, this.host.knowledge());
          }
        }
      }
    });
  }
  reconcile(id: string, outcome: 'confirmed' | 'not_sent', evidence: string): void {
    if (!evidence.trim() || evidence.length > 1000)
      throw new CrmError('Evidência independente obrigatória');
    const d = this.store.db.prepare('SELECT * FROM messaging_deliveries WHERE id=?').get(id);
    if (!d || !['reconciliation', 'pending'].includes(String(d.status)))
      throw new CrmError('Entrega não aguarda reconciliação');
    if (this.sending.has(String(d.conversationId)))
      throw new CrmError('Aguardar término da tentativa');
    this.store.atomic(() => {
      this.store.audit('delivery_reconciled', `${outcome}: ${evidence}`, String(d.conversationId));
      if (outcome === 'confirmed') this.confirm(id, 'manual');
      else {
        this.store.db
          .prepare("UPDATE messaging_deliveries SET status='not_sent',updatedAt=? WHERE id=?")
          .run(timestamp(), id);
        this.store.db
          .prepare("UPDATE messaging_messages SET status='failed' WHERE id=?")
          .run(String(d.messageId));
        this.store.db
          .prepare("UPDATE messaging_drafts SET status='failed' WHERE id=?")
          .run(String(d.draftId));
        this.store.assign(
          String(d.conversationId),
          'ceo',
          'CEO confirmou que não foi enviado; sem reenvio automático.',
        );
      }
    });
    this.changed();
  }
  deliveries(id: string): unknown[] {
    this.store.conversation(id);
    return this.store.db
      .prepare(
        'SELECT id,draftId,messageId,status,providerId,updatedAt FROM messaging_deliveries WHERE conversationId=? ORDER BY rowid DESC LIMIT 50',
      )
      .all(id);
  }
  workContext(id: string): Record<string, unknown> {
    const c = this.store.conversation(id);
    if (c.state !== 'open' || this.config.suspended || this.host.suspended())
      throw new CrmError('Conversa/canal bloqueado para agentes');
    return {
      conversationId: c.id,
      simulated: c.simulated,
      untrustedMessages: this.store
        .messages(id)
        .filter((m) => m.direction === 'inbound')
        .slice(-4)
        .map((m) => ({ body: m.body.slice(0, 1200), untrusted: true })),
      company: c.companyId ? modelCompany(this.host.crm.company(c.companyId)) : null,
      interest: !!c.interestedMessageId,
      linkAccepted: !!c.acceptedMessageId,
      identity:
        'Identifica-te como assistente virtual. Apenas rascunhos internos, sem ferramentas nem envio.',
    };
  }
  operation(task: SalesTask): Record<string, unknown> {
    const meta = task.input.messaging as { conversationId: string };
    const c = this.store.conversation(meta.conversationId);
    this.workContext(c.id);
    const k = this.host.knowledge();
    let draft = '';
    let summary = 'Operação determinística; sem inferência.';
    if (task.employeeId === 'hunter')
      summary = 'Hunter: sem recolha de números nem envio. Usar apenas fontes autorizadas do CRM.';
    if (task.employeeId === 'atlas') {
      if (c.companyId) this.host.crm.qualify(c.companyId, task.id);
      summary = 'Atlas: informação registada e adequação por regras; sem presumir consentimento.';
    }
    if (['maya', 'luna', 'victor'].includes(task.employeeId))
      draft = `Sou o assistente virtual do Agexa. ${task.employeeId === 'victor' ? 'Compreendo a sua dúvida. ' : ''}${k.confirmedFeatures.length ? 'Podemos explicar estas funcionalidades confirmadas: ' + k.confirmedFeatures.slice(0, 3).join('; ') + '. ' : ''}Que necessidade pretende resolver na organização do seu negócio?`;
    if (task.employeeId === 'sophia') {
      if (k.signupUrl && k.trialAvailable && c.interestedMessageId && c.acceptedMessageId)
        draft = `Sou o assistente virtual do Agexa. Perfeito! Podes criar a tua conta e experimentar gratuitamente durante 7 dias. Aqui está o link oficial: ${k.signupUrl}`;
      else
        summary =
          'Sophia: aguardar URL/oferta confirmados, interesse e aceitação. Nenhum convite pronto nem envio.';
    }
    return {
      summary,
      draft,
      inference: false,
      mode: 'rules',
      delivery: 'internal_only',
      ...(task.employeeId === 'orion' ? { messagingMetrics: this.snapshot().metrics } : {}),
    };
  }
  completed(task: SalesTask, result: Record<string, unknown> | null, error: string | null): void {
    if (!task.input.messaging) return;
    const meta = task.input.messaging as { conversationId: string; sourceMessageId: string };
    if (error) {
      this.store.audit(
        'agent_error',
        `${task.employeeId}: tarefa falhou; sem envio.`,
        meta.conversationId,
      );
      return;
    }
    if (result?.draft && typeof result.draft === 'string') {
      const c = this.store.conversation(meta.conversationId);
      if (c.state !== 'open') return;
      const kind = task.employeeId === 'sophia' ? 'invitation' : 'reply';
      let body = result.draft;
      if (task.kind === 'ai_request' && !/assistente virtual/i.test(body))
        body = 'Sou o assistente virtual do Agexa. ' + body;
      this.content(body, kind, c.id);
      if (kind === 'invitation') body = this.host.prepareInvitation?.(c.id, body) ?? body;
      this.content(body, kind, c.id);
      const draft = this.store.addDraft(
        c.id,
        body,
        task.employeeId,
        result.executionMode === 'test'
          ? 'test'
          : result.executionMode === 'gemini'
            ? 'gemini'
            : result.inference === true
              ? 'ollama'
              : 'rules',
        kind,
        task.id,
        meta.sourceMessageId,
      );
      if (kind === 'invitation') this.host.invitationDraft?.(draft);
    }
    this.store.audit(
      'agent_completed',
      `${task.employeeId} concluiu tarefa interna; nenhum envio.`,
      meta.conversationId,
    );
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    this.qr = null;
    const p = this.provider;
    this.provider = null;
    p?.removeAllListeners();
    if (p) await p.disconnect();
  }
  close(): void {
    this.closed = true;
    this.qr = null;
    const p = this.provider;
    this.provider = null;
    p?.removeAllListeners();
    if (p) void p.disconnect().catch(() => {});
  }
  get activeProvider(): MessagingProvider | null {
    return this.provider;
  }
}
