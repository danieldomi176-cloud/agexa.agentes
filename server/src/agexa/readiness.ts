import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

import { EMPLOYEES } from '../../../core/src/agexa.js';
import type {
  AgexaKnowledge,
  IntelligenceConfig,
  OllamaStatus,
} from '../../../core/src/intelligence.js';
import type { MessagingConnection } from '../../../core/src/messaging.js';
import type {
  EvidenceMode,
  OfferVerification,
  ReadinessCheck,
  ReadinessReport,
} from '../../../core/src/readiness.js';
import { CrmError } from './crm/error.js';
import { inferenceConfigurationDigest } from './ollama.js';

const stamp = () => new Date().toISOString();
const fingerprint = (k: AgexaKnowledge) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        signupUrl: k.signupUrl,
        trialDays: k.trialDays,
        confirmedFeatures: k.confirmedFeatures,
        approvedPrices: k.approvedPrices,
        policies: k.policies,
      }),
    )
    .digest('hex');
type BackupProof = { file: string; at: string; digest: string; bytes: number };
type Host = {
  knowledge: () => AgexaKnowledge;
  config: () => IntelligenceConfig;
  ollama: () => OllamaStatus | null;
  messaging: () => MessagingConnection;
  suspended: () => boolean;
};

/** Evidence is derived from backend observations, never writable status flags from a browser. */
export class OperationalReadiness {
  private backingUp = false;
  constructor(
    private readonly db: DatabaseSync,
    private readonly directory: string,
    private readonly host: Host,
  ) {}
  private read<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get('operational:' + key);
    return row ? (JSON.parse(String(row.value)) as T) : null;
  }
  private save(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run('operational:' + key, JSON.stringify(value));
  }
  private audit(action: string): void {
    this.db
      .prepare('INSERT INTO events(at,action,detail) VALUES (?,?,?)')
      .run(stamp(), action, 'Verificação operacional solicitada pelo CEO; sem contacto externo');
  }
  offer(): ReadinessReport['offer'] {
    const p = this.read<{
      fingerprint: string;
      at: string;
      mode: EvidenceMode;
      evidence: OfferVerification;
    }>('offer');
    return {
      valid: !!p && p.fingerprint === fingerprint(this.host.knowledge()),
      verifiedAt: p?.at ?? null,
      mode: p?.mode ?? 'manual',
      evidence: p?.evidence ?? null,
    };
  }
  verifyOffer(evidence: OfferVerification): void {
    const knowledge = this.host.knowledge();
    if (
      !knowledge.signupUrl ||
      !knowledge.confirmedFeatures.length ||
      evidence.confirmed !== true ||
      typeof evidence.paymentRequired !== 'boolean'
    )
      throw new CrmError(
        'Guardar URL e funcionalidades verificadas antes de confirmar a oferta',
        400,
      );
    for (const key of [
      'registrationEvidence',
      'startsWhen',
      'expiryBehaviour',
      'includedFeatures',
    ] as const) {
      if (
        typeof evidence[key] !== 'string' ||
        evidence[key].trim().length < 10 ||
        evidence[key].length > 1000
      )
        throw new CrmError('Evidência incompleta da oferta: ' + key, 400);
    }
    const mode =
      process.env.AGEXA_INFERENCE_TEST_MODE === '1' || process.env.AGEXA_MESSAGING_TEST_MODE === '1'
        ? 'simulated'
        : 'manual';
    this.save('offer', { fingerprint: fingerprint(knowledge), at: stamp(), mode, evidence });
    this.audit('offer_verified');
  }
  assertOffer(value: AgexaKnowledge): void {
    if (!value.trialAvailable) return;
    const p = this.read<{ fingerprint: string; mode: EvidenceMode }>('offer');
    const test =
      process.env.AGEXA_INFERENCE_TEST_MODE === '1' ||
      process.env.AGEXA_MESSAGING_TEST_MODE === '1';
    if (!p || p.fingerprint !== fingerprint(value) || (p.mode === 'simulated' && !test))
      throw new CrmError(
        'Oferta não verificada ou configuração alterada. Guardar com oferta inativa e verificar em Prontidão operacional.',
        409,
      );
  }
  async createBackup(): Promise<{ at: string; bytes: number; integrity: 'ok' }> {
    if (this.backingUp) throw new CrmError('Backup já em curso');
    this.backingUp = true;
    const dir = path.join(this.directory, 'backups');
    const file = `sales-${randomUUID()}.sqlite`;
    const dest = path.join(dir, file);
    let created = false;
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())
        throw new CrmError('Diretório de backup não pode ser uma ligação simbólica');
      fs.chmodSync(dir, 0o700);
      // Exclusive pre-creation fixes permissions before SQLite writes any private bytes.
      fs.closeSync(fs.openSync(dest, 'wx', 0o600));
      created = true;
      await backup(this.db, dest);
      const copy = new DatabaseSync(dest, { readOnly: true });
      try {
        if (copy.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
          throw Error('Backup SQLite inválido');
      } finally {
        copy.close();
      }
      const proof = {
        file,
        at: stamp(),
        digest: createHash('sha256').update(fs.readFileSync(dest)).digest('hex'),
        bytes: fs.statSync(dest).size,
      };
      this.save('backup', proof);
      this.audit('backup_verified');
      // Retain five known backup files, never touch auth/session or arbitrary operator files.
      const files = fs
        .readdirSync(dir)
        .filter((n) => /^sales-[a-f0-9-]{36}\.sqlite$/.test(n))
        .sort(
          (a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs,
        );
      for (const old of files.slice(5)) fs.unlinkSync(path.join(dir, old));
      return { at: proof.at, bytes: proof.bytes, integrity: 'ok' };
    } catch (error) {
      if (created) fs.rmSync(dest, { force: true });
      throw error;
    } finally {
      this.backingUp = false;
    }
  }
  private backupCheck(at: string): ReadinessCheck {
    const p = this.read<BackupProof>('backup');
    const base = {
      id: 'backups',
      name: 'Backups',
      mode: 'technical' as const,
      checkedAt: p?.at ?? null,
      nextAction:
        'Testar recuperação isolada; copiar backups privados para armazenamento autorizado fora desta máquina.',
    };
    if (!p)
      return {
        ...base,
        state: 'PENDENTE',
        evidence: 'Nenhum backup verificado pelo Office neste diretório.',
        blocker: 'Criar cópia consistente pelo botão de backup.',
      };
    try {
      if (!/^sales-[a-f0-9-]{36}\.sqlite$/.test(p.file)) throw Error();
      const file = path.join(this.directory, 'backups', p.file);
      const stat = fs.lstatSync(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.mode & 0o077 ||
        stat.size !== p.bytes ||
        createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== p.digest
      )
        throw Error();
      return {
        ...base,
        checkedAt: at,
        state: 'VALIDADO',
        evidence: `Cópia consistente, integridade SQLite e SHA-256 verificados; criada ${p.at}. Isto não comprova restauração noutra máquina.`,
        blocker: null,
      };
    } catch {
      return {
        ...base,
        checkedAt: at,
        state: 'ERRO',
        evidence: 'A cópia registada falta, mudou ou tem permissões inadequadas.',
        blocker: 'Criar novo backup e investigar a cópia anterior.',
      };
    }
  }
  check(): ReadinessReport {
    const at = stamp();
    const checks: ReadinessCheck[] = [];
    const add = (
      id: string,
      name: string,
      state: ReadinessCheck['state'],
      evidence: string,
      blocker: string | null = null,
      nextAction = 'Conservar os controlos e repetir após alterações.',
      mode: EvidenceMode = 'technical',
      checkedAt: string | null = at,
    ) => checks.push({ id, name, state, evidence, blocker, nextAction, mode, checkedAt });
    add(
      'server',
      'Servidor',
      'VALIDADO',
      'Pedido autenticado processado pelo backend atual. Não valida disponibilidade pública.',
    );
    const integrity = this.db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok';
    add(
      'sqlite',
      'SQLite',
      integrity ? 'VALIDADO' : 'ERRO',
      `Schema ${String(this.db.prepare('PRAGMA user_version').get()?.user_version)}; quick_check ${integrity ? 'ok' : 'falhou'}.`,
      integrity ? null : 'Integridade SQLite falhou.',
    );
    const running = Number(
      this.db.prepare("SELECT count(*) n FROM tasks WHERE status='running'").get()?.n ?? 0,
    );
    add(
      'tasks',
      'Motor de tarefas',
      this.host.suspended() ? 'PENDENTE' : 'VALIDADO',
      `Fila persistente; ${running} tarefa(s) em execução. Recuperação interrompe sem repetir inferência.`,
      this.host.suspended() ? 'Operações suspensas pelo CEO.' : null,
    );
    const status = this.host.ollama();
    const fresh =
      !!status?.checkedAt &&
      Date.now() - Date.parse(status.checkedAt) < (status.freshForMs ?? 20000);
    const simulated = status?.executionMode === 'test';
    const cloud = this.host.config().provider === 'gemini';
    const cloudNeedsSetup =
      cloud &&
      (!this.host.config().cloudAuthorized ||
        !this.host.config().freeTierConfirmed ||
        !status?.credentialConfigured);
    add(
      'ollama',
      cloud ? 'IA na nuvem · Gemini' : 'Ollama',
      cloudNeedsSetup
        ? 'PENDENTE'
        : fresh && status?.reachable && !simulated
          ? 'VALIDADO'
          : fresh && !status?.reachable
            ? 'ERRO'
            : 'PENDENTE',
      status?.reachable
        ? cloud
          ? 'Lista de modelos Gemini respondeu; não comprova inferência nem elegibilidade gratuita.'
          : 'GET /api/tags respondeu; isto não comprova inferência.'
        : (status?.error ?? 'Adaptador real não configurado.'),
      simulated
        ? 'Serviço de teste: não comprova IA real.'
        : fresh && status?.reachable
          ? null
          : 'Serviço ainda não verificado ou inacessível.',
      cloud
        ? 'Configurar chave no backend, confirmar nível gratuito e dados autorizados, selecionar modelo elegível e validar uma tarefa.'
        : 'Ollama é opcional; Chromebook pode usar IA na nuvem sem instalar modelo local.',
      simulated ? 'simulated' : 'technical',
      status?.checkedAt ?? null,
    );
    const config = this.host.config();
    const employees = EMPLOYEES.map((e) => {
      const row = this.db
        .prepare(
          "SELECT * FROM tasks WHERE employeeId=? AND kind='ai_request' ORDER BY rowid DESC LIMIT 1",
        )
        .get(e.id);
      const result = row?.result
        ? (JSON.parse(String(row.result)) as Record<string, unknown>)
        : null;
      const real =
        row?.status === 'completed' &&
        (result?.executionMode === 'ollama' || result?.executionMode === 'gemini') &&
        result.inference === true &&
        result.model === config.model &&
        result.configurationDigest === inferenceConfigurationDigest(config) &&
        (status?.executionMode === 'ollama' || status?.executionMode === 'gemini');
      const test = result?.executionMode === 'test' || (!!row && !result && simulated);
      return {
        employeeId: e.id,
        taskId: row ? String(row.id) : null,
        status: real
          ? 'real_contract_pass'
          : test && row?.status === 'completed'
            ? 'simulated'
            : row
              ? String(row.status)
              : 'not_executed',
        model: row?.model ? String(row.model) : null,
        durationMs:
          row?.durationMs === null || row?.durationMs === undefined ? null : Number(row.durationMs),
        at: row?.finishedAt ? String(row.finishedAt) : null,
        mode: (real ? 'real' : test ? 'simulated' : 'technical') as EvidenceMode,
        error: row?.error ? String(row.error) : null,
      };
    });
    const real = employees.some((e) => e.mode === 'real');
    const failed = employees.some((e) => e.status === 'error' && e.model === config.model);
    add(
      'model',
      'Modelo de IA',
      failed ? 'ERRO' : real && fresh && status?.connected ? 'VALIDADO' : 'PENDENTE',
      real
        ? 'Existe tarefa concluída com contrato JSON e modelo atual.'
        : 'Nenhuma inferência real validada com o modelo atual.',
      failed
        ? 'Existe falha de geração/contrato numa tarefa do modelo atual; consultar o erro do funcionário.'
        : real && fresh && status?.connected
          ? null
          : 'Configurar não comprova geração.',
      'Executar validação controlada, rever utilidade e consultar a tarefa completa.',
      simulated ? 'simulated' : real ? 'real' : 'technical',
    );
    const nexus = employees[0];
    add(
      'nexus',
      'Nexus',
      nexus.mode === 'real' ? 'VALIDADO' : nexus.status === 'error' ? 'ERRO' : 'PENDENTE',
      nexus.taskId ? `Tarefa ${nexus.taskId}: ${nexus.status}.` : 'Sem execução real registada.',
      nexus.mode === 'real' ? null : 'Nexus ainda não validado com inferência real.',
      'Executar ordem controlada sobre uma barbearia fictícia na Beira.',
      nexus.mode,
      nexus.at,
    );
    for (const [id, name, table] of [
      ['crm', 'CRM', 'crm_companies'],
      ['inbox', 'Inbox', 'messaging_conversations'],
      ['conversions', 'Conversões', 'conversion_events'],
    ] as const) {
      this.db.prepare(`SELECT count(*) FROM ${table}`).get();
      add(
        id,
        name,
        'VALIDADO',
        'Componente persistente acessível; não comprova dados ou operações externas.',
      );
    }
    const source = this.db
      .prepare(
        'SELECT count(*) n FROM crm_sources WHERE enabled=1 AND termsReviewed=1 AND commercialReuseAllowed=1',
      )
      .get();
    add(
      'prospecting',
      'Prospeção',
      Number(source?.n) > 0 ? 'VALIDADO' : 'PENDENTE',
      'Importação autorizada e seleção interna disponíveis; sem descoberta web validada.',
      Number(source?.n) > 0 ? null : 'Nenhuma fonte autorizada ativa.',
      'Rever termos e importar apenas empresas autorizadas.',
    );
    const channel = this.host.messaging();
    add(
      'whatsapp',
      'WhatsApp experimental',
      channel.status === 'error'
        ? 'ERRO'
        : channel.status === 'connected' &&
            !channel.simulated &&
            channel.provider === 'web_experimental'
          ? 'VALIDADO'
          : 'PENDENTE',
      `Provider ${channel.provider}; estado ${channel.status}. Isto não comprova envio/receção/reconexão/revogação.`,
      channel.error ??
        (channel.status === 'connected' && !channel.simulated
          ? null
          : 'Não existe sessão experimental real ligada.'),
      'Seguir checklist supervisionada com número secundário. Automático bloqueado.',
      channel.simulated ? 'simulated' : 'technical',
    );
    const integration = this.db.prepare("SELECT * FROM conversion_config WHERE id='main'").get();
    const feed = this.db
      .prepare(
        "SELECT id FROM conversion_sync_runs WHERE status='completed' AND nonce IS NOT NULL ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    // A completed test sync can never promote an external integration to real readiness.
    const lastSync = integration?.lastSync ? String(integration.lastSync) : null;
    const syncConfig = integration
      ? (JSON.parse(String(integration.value)) as {
          appId?: string;
          endpoint?: string;
          permissionEvidence?: string;
        })
      : null;
    const feedVerified =
      !!feed &&
      !!lastSync &&
      integration?.status === 'authenticated_feed' &&
      !!syncConfig?.appId &&
      !!syncConfig.endpoint;
    add(
      'base44',
      'Base44',
      integration?.error ? 'ERRO' : feedVerified ? 'VALIDADO' : 'PENDENTE',
      feedVerified
        ? `Leitura assinada autenticada registada em ${lastSync}; não comprova jornada de cadastro/pagamento.`
        : 'Contrato implementado; aplicação real não autenticada/validada.',
      integration?.error
        ? String(integration.error)
        : feedVerified
          ? null
          : 'ID, função autorizada, permissões e segredo ainda precisam de validação.',
      'Usar o feed existente após implantação autorizada; alternativa manual disponível.',
      feedVerified ? 'real' : 'technical',
      lastSync,
    );
    const offer = this.offer();
    const active = offer.valid && this.host.knowledge().trialAvailable;
    add(
      'offer',
      'Oferta de sete dias',
      active && offer.mode !== 'simulated' ? 'VALIDADO' : 'PENDENTE',
      offer.valid
        ? 'Evidência do CEO corresponde à configuração atual; não é validação automática Base44.'
        : 'Sem evidência atual do cadastro, início, fim e funcionalidades.',
      offer.mode === 'simulated'
        ? 'Prova simulada não valida a oferta operacional.'
        : active
          ? null
          : 'Oferta inativa ou confirmação desatualizada.',
      'Verificar a plataforma, registar evidência e só depois ativar em Conhecimento.',
      offer.mode,
      offer.verifiedAt,
    );
    checks.push(this.backupCheck(at));
    const mode = fs.statSync(path.join(this.directory, 'sales.sqlite')).mode;
    add(
      'security',
      'Segurança de acesso',
      mode & 0o077 ? 'ERRO' : 'VALIDADO',
      'Pedido passou pela autenticação/Host/Origin existentes; SQLite privado. Não equivale a auditoria de implantação.',
      mode & 0o077 ? 'Permissões SQLite inadequadas.' : null,
      'Manter servidor e Ollama privados; token partilhado do CEO não é gestão multiutilizador.',
    );
    const report = {
      checkedAt: at,
      pilotReady:
        checks.every((c) => c.state === 'VALIDADO') && employees.every((e) => e.mode === 'real'),
      scope:
        'Observações desta instância. Componentes locais, declarações do CEO e integrações externas têm evidências distintas. Sem prova de produção ou máquina independente.',
      checks,
      employees,
      offer,
      history: this.read<ReadinessReport['history']>('history') ?? [],
    };
    return report;
  }
  recordCheck(): ReadinessReport {
    const report = this.check();
    const row = {
      at: report.checkedAt,
      validated: report.checks.filter((c) => c.state === 'VALIDADO').length,
      pending: report.checks.filter((c) => c.state === 'PENDENTE').length,
      errors: report.checks.filter((c) => c.state === 'ERRO').length,
    };
    report.history = [row, ...report.history].slice(0, 50);
    this.save('history', report.history);
    this.audit('readiness_checked');
    return report;
  }
}
