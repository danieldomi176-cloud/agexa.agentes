import { useEffect, useState } from 'react';

import type {
  ConfirmationOrigin,
  ConversionConfig,
  ConversionEvent,
  ConversionFact,
  ConversionKind,
  ConversionSnapshot,
} from '../../../core/src/conversion.js';
import type { Company } from '../../../core/src/crm.js';
import type { SalesOffice } from '../hooks/useSalesOffice.js';
import { serverToken } from '../transport/serverToken.js';
import { IntelligencePanel } from './IntelligencePanel.js';
type Act = (route: string, body: unknown, done?: () => void) => void;
async function read<T>(route: string): Promise<T> {
  const r = await fetch('/api/agexa/' + route, {
    headers: { Authorization: `Bearer ${serverToken ?? ''}` },
  });
  if (!r.ok) throw Error('Não foi possível consultar conversões privadas');
  return r.json() as Promise<T>;
}
const date = (v: string | null) => (v ? new Date(v).toLocaleString() : 'Não disponível');
const origin = (v: ConfirmationOrigin) =>
  ({
    integration: 'Feed autenticado',
    manual: 'Confirmação manual do CEO',
    simulated: 'SIMULAÇÃO',
  })[v];
const label: Record<ConversionKind, string> = {
  account_created: 'Conta criada',
  trial_started: 'Teste iniciado',
  trial_extended: 'Teste prorrogado',
  trial_ended: 'Teste terminado',
  trial_cancelled: 'Teste cancelado',
  payment_confirmed: 'Pagamento confirmado',
};
const money = (minor: number, currency: string): string => {
  const format = new Intl.NumberFormat('pt-MZ', { style: 'currency', currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(minor / 10 ** digits);
};
const localNow = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
interface Handoff {
  followup: { id: string; notes: string; followupAt: string | null; closedReason: string | null };
  invite: { sentUrl: string; confirmedAt: string; employeeId: string; simulated: boolean };
  company: Company;
  lastReceived: { body: string } | null;
  received: { id: string; body: string }[];
  confirmedArguments: { body: string }[];
  observedObjections: { body: string; evidence: string }[];
  account: { externalId: string; origin: ConfirmationOrigin } | null;
  nextAction: string;
}
export function ConversionPanel({
  office,
  act,
  ready,
  openCompany,
  openConversation,
}: {
  office: SalesOffice;
  act: Act;
  ready: boolean;
  openCompany: (id: string) => void;
  openConversation: (id: string) => void;
}) {
  const data = office.snapshot?.conversion;
  const [view, setView] = useState('dashboard'),
    [target, setTarget] = useState(''),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<Handoff | null>(null),
    [error, setError] = useState('');
  const [events, setEvents] = useState<{ items: ConversionEvent[]; page: number; total: number }>({
      items: [],
      page: 1,
      total: 0,
    }),
    [page, setPage] = useState(1),
    [status, setStatus] = useState('pending');
  const [evidence, setEvidence] = useState(''),
    [alias, setAlias] = useState(false),
    [readiness, setReadiness] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    if (view === 'events')
      void read<typeof events>(`conversion/events?status=${status}&page=${page}`)
        .then((r) => {
          if (alive) setEvents(r);
        })
        .catch((e: Error) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [data, view, page, status]);
  useEffect(() => {
    let alive = true;
    if (selected)
      void read<Handoff>(`conversion/handoffs/${selected}`)
        .then((r) => {
          if (alive) setDetail(r);
        })
        .catch((e: Error) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [data, selected]);
  if (!data) return <p>Reiniciar o backend atualizado para abrir o Conversion Engine.</p>;
  return (
    <section className="conversion-module">
      <h3>AGEXA SALES CONVERSION DASHBOARD</h3>
      <p className="agexa-notice">
        Cadastros, testes e pagamentos exigem factos confirmados. Preparar/enviar um link não
        confirma cadastro. A origem aparece em cada registo.
      </p>
      <p>
        Base44: {data.integration.status} · Última sincronização: {date(data.integration.lastSync)}{' '}
        ·{' '}
        {data.integration.secretConfigured
          ? 'Chave disponível no backend; autenticação ainda depende do feed'
          : 'Sem chave de integração no backend'}
      </p>
      {data.integration.error && <p role="alert">{data.integration.error}</p>}
      {error && <p role="alert">{error}</p>}
      <nav className="crm-actions" aria-label="Módulos de conversão">
        {[
          ['dashboard', 'Funil de conversão'],
          ['trials', 'Free Trial Tracker'],
          ['ceo', 'Atendimento CEO'],
          ['events', 'Confirmações e eventos'],
          ['config', 'Integração Base44'],
          ['validation', 'Validação técnica'],
        ].map(([key, title]) => (
          <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
            {title}
          </button>
        ))}
      </nav>
      {view === 'dashboard' && (
        <>
          <div className="crm-metrics">
            {data.metrics.funnel.map((m) => (
              <article key={m.key}>
                <strong>{m.count}</strong>
                <span>{m.label}</span>
                <small>{m.origin}</small>
              </article>
            ))}
          </div>
          <h4>Confirmações separadas por origem</h4>
          <div className="crm-scroll">
            <table>
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Contas</th>
                  <th>Testes ativos</th>
                  <th>Expirados confirmados</th>
                  <th>Pagantes</th>
                  <th>Receita confirmada</th>
                </tr>
              </thead>
              <tbody>
                {(['integration', 'manual', 'simulated'] as const).map((key) => {
                  const m = data.metrics.origins[key];
                  return (
                    <tr key={key}>
                      <td>{origin(key)}</td>
                      <td>{m.accounts}</td>
                      <td>{m.activeTrials}</td>
                      <td>{m.expiredTrials}</td>
                      <td>{m.paying}</td>
                      <td>
                        {Object.keys(m.revenue).length
                          ? Object.entries(m.revenue).map(([currency, amount]) => (
                              <p key={currency}>{money(amount, currency)}</p>
                            ))
                          : 'Não disponível'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="agexa-subtle">
            Contagens de registos acompanhados pelo Office, não total de clientes da plataforma.
            Simulações ficam fora do funil real. Receita é separada por moeda e origem.
          </p>
          <h4>Rácio observado entre etapas</h4>
          {data.metrics.funnel.map((m) => (
            <div className="crm-bar" key={m.key}>
              <span>{m.label}</span>
              <meter min={0} max={1} value={Math.min(1, m.rate ?? 0)} />
              <span>
                {m.rate === null
                  ? 'Não disponível'
                  : `${(m.rate * 100).toFixed(1)}% (${m.numerator}/${m.denominator})`}
              </span>
            </div>
          ))}
          <p className="agexa-subtle">
            Cada rácio usa a interseção das empresas registadas nas duas etapas, dividida pelas
            empresas da etapa anterior; não prova causalidade. Atribuição depende de
            referência/conta exata ou associação auditada pelo CEO.
          </p>
          <h4>Conversões por setor</h4>
          {data.metrics.sectors.map((s) => (
            <p key={s.sector}>
              {s.sector || 'Sem setor'} · {s.accounts} contas · {s.paying} pagantes
            </p>
          ))}
          <h4>Conversões por funcionário que preparou o primeiro convite</h4>
          {data.metrics.employees.map((e) => (
            <p key={e.employee}>
              {e.employee} · {e.accounts} contas · {e.paying} pagantes
            </p>
          ))}
          <p>
            {data.metrics.awaitingCeo} acompanhamentos reais a cargo do CEO ·{' '}
            {data.metrics.pendingEvents} eventos pendentes · {data.metrics.nearEnd} testes reais
            perto do fim
          </p>
          <p>
            Encerradas sem conversão: {data.metrics.closedLost}. Confirmações anteriores sem
            informação completa no tracker: {data.metrics.legacyManual.accounts} cadastros,{' '}
            {data.metrics.legacyManual.trialsWithoutDates} testes sem datas,{' '}
            {data.metrics.legacyManual.payingWithoutAmount} pagantes sem montante. Os registos
            originais permanecem no CRM.
          </p>
          <details>
            <summary>Convites e atribuição comercial</summary>
            {data.invites.map((inv) => (
              <article className="agexa-task" key={inv.id}>
                <strong>
                  {companyName(office, inv.companyId)} ·{' '}
                  {inv.simulated ? 'SIMULAÇÃO' : (inv.confirmationOrigin ?? 'Ainda não confirmado')}
                </strong>
                <p>Referência opaca: {inv.reference}</p>
                <p>
                  Preparado: {date(inv.preparedAt)} · Confirmado: {date(inv.confirmedAt)} ·{' '}
                  {inv.employeeId}
                </p>
                <p className="messaging-body">{inv.sentUrl}</p>
                <button onClick={() => openCompany(inv.companyId)}>Consultar oportunidade</button>
              </article>
            ))}
          </details>
          <Review act={act} ready={ready} />
        </>
      )}
      {view === 'trials' && (
        <>
          <h4>FREE TRIAL TRACKER</h4>
          <h4>Cadastros confirmados</h4>
          {data.accounts.map((a) => (
            <article className="agexa-task" key={a.id}>
              <strong>{companyName(office, a.companyId)}</strong>
              <p>
                {a.externalId} · {date(a.createdAt)} · {origin(a.origin)}
              </p>
              <button
                onClick={() => {
                  setTarget(a.companyId);
                  setView('events');
                }}
              >
                Registar teste ou pagamento
              </button>
            </article>
          ))}
          <p>
            Datas efetivas fornecidas pela aplicação ou confirmadas manualmente. A oferta comercial
            é de sete dias; prorrogações reais ficam no histórico.
          </p>
          <button disabled={!ready} onClick={() => act('conversion/trial-alerts', {})}>
            Atualizar alertas internos
          </button>
          <div className="crm-scroll">
            <table>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Início</th>
                  <th>Término informado</th>
                  <th>Dias restantes</th>
                  <th>Estado</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {data.trials.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button onClick={() => openCompany(t.companyId)}>
                        {companyName(office, t.companyId)}
                      </button>
                    </td>
                    <td>{date(t.startAt)}</td>
                    <td>{date(t.endAt)}</td>
                    <td>{t.remainingDays}</td>
                    <td>
                      {t.effectiveState === 'end_due_awaiting_confirmation'
                        ? 'Fim previsto atingido; aguarda confirmação'
                        : t.status}
                      <small>{t.actualDurationDays.toFixed(1)} dias informados</small>
                    </td>
                    <td>{origin(t.origin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.trials.length && (
            <p>Sem datas de teste confirmadas. Não são calculadas a partir do envio do link.</p>
          )}
        </>
      )}
      {view === 'ceo' && (
        <>
          <h4>ATENDIMENTO DO CEO</h4>
          {data.followups.map((f) => (
            <article className="agexa-task" key={f.id}>
              <strong>{companyName(office, f.companyId)}</strong>
              <p>
                {f.closedReason ? 'Encerrada: ' + f.closedReason : 'Acompanhamento do CEO'} ·{' '}
                {date(f.followupAt)}
              </p>
              <div className="crm-actions">
                <button onClick={() => setSelected(f.id)}>Consultar transferência</button>
                <button onClick={() => openConversation(f.conversationId)}>
                  Abrir conversa na inbox
                </button>
                <button onClick={() => openCompany(f.companyId)}>Abrir oportunidade CRM</button>
                <button
                  onClick={() => {
                    setTarget(f.companyId);
                    setView('events');
                  }}
                >
                  Confirmar cadastro ou pagamento
                </button>
              </div>
            </article>
          ))}
          {detail && selected === detail.followup.id && (
            <HandoffDetail key={selected} detail={detail} act={act} ready={ready} />
          )}
        </>
      )}
      {view === 'events' && (
        <>
          <ManualConfirmation
            key={target || 'manual'}
            office={office}
            data={data}
            act={act}
            ready={ready}
            initialCompany={target}
          />
          <h4>Eventos e reconciliação</h4>
          <label>
            Filtrar eventos
            <select
              aria-label="Filtrar eventos"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="pending">Pendentes</option>
              <option value="applied">Aplicados</option>
              <option value="rejected">Rejeitados</option>
              <option value="">Todos</option>
            </select>
          </label>
          <label>
            Empresa para associação manual
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="ID da oportunidade CRM"
            />
          </label>
          <label>
            Evidência de associação
            <input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </label>
          <label className="agexa-check">
            <input type="checkbox" checked={alias} onChange={(e) => setAlias(e.target.checked)} />
            Confirmei que o ID externo é um alias da conta já associada a esta empresa.
          </label>
          {events.items.map((e) => (
            <article className="agexa-task" key={e.id}>
              <strong>
                {label[e.kind]} · {origin(e.origin)} · {e.status}
              </strong>
              <p>
                {date(e.occurredAt)} · Conta:{' '}
                {e.payload?.accountId ?? 'Payload redigido por retenção'} · Associação:{' '}
                {e.attribution}
              </p>
              <p>{e.reason}</p>
              {e.status === 'pending' && (
                <button
                  disabled={!ready || !evidence}
                  onClick={() => act(`conversion/events/${e.id}/reject`, { evidence })}
                >
                  Rejeitar evento com motivo
                </button>
              )}
              {e.status === 'pending' && (
                <button
                  disabled={!ready || !target || !evidence}
                  onClick={() =>
                    act(`conversion/events/${e.id}/resolve`, {
                      companyId: target,
                      evidence,
                      allowAlias: alias,
                      confirmed: true,
                    })
                  }
                >
                  Associar com evidência do CEO
                </button>
              )}
            </article>
          ))}
          <div className="crm-actions">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Eventos anteriores
            </button>
            <span>Página {page}</span>
            <button disabled={page * 50 >= events.total} onClick={() => setPage(page + 1)}>
              Próximos eventos
            </button>
          </div>
        </>
      )}
      {view === 'config' && (
        <>
          <IntegrationConfig
            key={data.config.appId + data.config.syncMode}
            data={data}
            act={act}
            ready={ready}
          />
          <h4>Link e oferta: base comercial existente</h4>
          <p>
            Aplicação indicada pelo CEO:{' '}
            <a href="https://agexa-flix.base44.app" target="_blank" rel="noreferrer">
              agexa-flix.base44.app
            </a>
            . O ID interno e a capacidade de Backend Functions não são deduzidos do domínio.
            Confirmar abaixo o ponto oficial de cadastro e a oferta.
          </p>
          <IntelligencePanel office={office} tab="knowledge" act={act} ready={ready} />
        </>
      )}
      {view === 'validation' && (
        <>
          <h4>Verificação independente de IA e canal</h4>
          <p>
            Uma chamada só comprova inferência quando o adaptador recebe uma resposta real e valida
            o contrato. Emuladores são identificados como simulação.
          </p>
          <div className="crm-actions">
            <button disabled={!ready} onClick={() => act('conversion/validation/inference', {})}>
              Executar verificação de inferência
            </button>
            <button
              onClick={() => {
                void read('conversion/validation/readiness')
                  .then(setReadiness)
                  .catch((e: Error) => setError(e.message));
              }}
            >
              Consultar preparação técnica
            </button>
          </div>
          {readiness !== null && (
            <pre className="conversion-json">{JSON.stringify(readiness, null, 2)}</pre>
          )}
          {data.validations.map((v) => (
            <article className="agexa-task" key={v.id}>
              <strong>
                {v.mode} · {v.status}
              </strong>
              <p>
                {date(v.createdAt)} · Modelo: {v.model ?? 'Não selecionado'} · Duração:{' '}
                {v.durationMs === null ? 'Não disponível' : v.durationMs + ' ms'}
              </p>
              <p>{v.detail}</p>
            </article>
          ))}
          <p>
            WhatsApp real exige número secundário, autorização, rede permitida e validação das
            etapas separadas: navegador, sessão, QR, digitalização, autenticação, ligação, receção,
            aprovação, aceitação, desconexão, reconexão e revogação. Não foram validadas por um
            Mock.
          </p>
        </>
      )}
      <h4>Notificações persistentes</h4>
      {data.notices.map((n) => (
        <article className="agexa-event" key={n.id}>
          <strong>{n.kind}</strong>
          <p>{n.body}</p>
          <small>{date(n.createdAt)}</small>
          <div className="crm-actions">
            {n.conversationId && (
              <button onClick={() => openConversation(n.conversationId!)}>Abrir conversa</button>
            )}
            <button onClick={() => openCompany(n.companyId)}>Abrir CRM</button>
            {!n.seenAt && (
              <button disabled={!ready} onClick={() => act(`conversion/notices/${n.id}/seen`, {})}>
                Marcar como vista
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
function companyName(office: SalesOffice, id: string): string {
  return office.snapshot?.crm?.companies.find((c) => c.id === id)?.name ?? id;
}
function Review({ act, ready }: { act: Act; ready: boolean }) {
  const [who, setWho] = useState('orion'),
    [ai, setAI] = useState(false);
  return (
    <details>
      <summary>Revisão interna Nexus, Sophia e Orion</summary>
      <label>
        Responsável da revisão
        <select
          aria-label="Responsável da revisão"
          value={who}
          onChange={(e) => setWho(e.target.value)}
        >
          <option value="orion">Orion</option>
          <option value="sophia">Sophia</option>
          <option value="nexus">Nexus</option>
        </select>
      </label>
      <label className="agexa-check">
        <input type="checkbox" checked={ai} onChange={(e) => setAI(e.target.checked)} />
        Usar modelo Ollama verificado
      </label>
      <button
        disabled={!ready}
        onClick={() => act('conversion/review', { employeeId: who, useAI: ai })}
      >
        Criar tarefa de análise interna
      </button>
      <p>A tarefa não altera cadastros, pagamentos ou a responsabilidade humana da conversa.</p>
    </details>
  );
}
function IntegrationConfig({
  data,
  act,
  ready,
}: {
  data: ConversionSnapshot;
  act: Act;
  ready: boolean;
}) {
  const [value, setValue] = useState<ConversionConfig>(data.config);
  return (
    <>
      <h4>AgexaBase44Connector</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act('conversion/config', value);
        }}
      >
        <label>
          ID interno da aplicação Base44
          <input
            value={value.appId}
            onChange={(e) => setValue({ ...value, appId: e.target.value })}
          />
        </label>
        <label>
          Endpoint HTTPS da função autorizada
          <input
            type="url"
            value={value.endpoint ?? ''}
            onChange={(e) => setValue({ ...value, endpoint: e.target.value || null })}
          />
        </label>
        <label>
          Modo de sincronização
          <select
            aria-label="Modo de sincronização"
            value={value.syncMode}
            onChange={(e) =>
              setValue({ ...value, syncMode: e.target.value as ConversionConfig['syncMode'] })
            }
          >
            <option value="manual">Confirmação manual</option>
            <option value="on_demand">Feed assinado a pedido do CEO</option>
          </select>
        </label>
        <p>
          Autenticação: HMAC-SHA256, chave apenas no backend. Nunca introduzir segredos aqui. A
          função e a entidade de eventos têm de ser autorizadas na aplicação Base44.
        </p>
        <label>
          Permissões e capacidade confirmadas
          <textarea
            value={value.permissionEvidence}
            onChange={(e) => setValue({ ...value, permissionEvidence: e.target.value })}
          />
        </label>
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={value.referenceSupported}
            onChange={(e) => setValue({ ...value, referenceSupported: e.target.checked })}
          />
          Confirmei que o cadastro real captura e conserva a referência comercial.
        </label>
        <label>
          Parâmetro da referência
          <input
            value={value.referenceParameter}
            onChange={(e) => setValue({ ...value, referenceParameter: e.target.value })}
          />
        </label>
        <label>
          Retenção de payloads em dias
          <input
            type="number"
            min={30}
            max={3650}
            value={value.retentionDays}
            onChange={(e) => setValue({ ...value, retentionDays: Number(e.target.value) })}
          />
        </label>
        <button disabled={!ready}>Guardar integração</button>
      </form>
      <div className="crm-actions">
        <button
          disabled={!ready || value.syncMode !== 'on_demand' || !data.integration.secretConfigured}
          onClick={() => act('conversion/sync', {})}
        >
          Sincronizar feed autorizado
        </button>
        <button disabled={!ready} onClick={() => act('conversion/retention', {})}>
          Aplicar retenção de payloads antigos
        </button>
      </div>
      <p className="agexa-subtle">
        Retenção remove apenas payloads antigos de eventos aplicados. IDs, hashes, factos
        financeiros e histórico operacional mantêm-se para impedir reprocessamento.
      </p>
    </>
  );
}
function ManualConfirmation({
  office,
  data,
  act,
  ready,
  initialCompany,
}: {
  office: SalesOffice;
  data: ConversionSnapshot;
  act: Act;
  ready: boolean;
  initialCompany: string;
}) {
  const [company, setCompany] = useState(initialCompany),
    [kind, setKind] = useState<ConversionKind>('account_created'),
    [accountId, setAccount] = useState(''),
    [reference, setReference] = useState(''),
    [occurred, setOccurred] = useState(localNow()),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [receipt, setReceipt] = useState(''),
    [amount, setAmount] = useState(''),
    [currency, setCurrency] = useState('MZN'),
    [evidence, setEvidence] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [eventId, setEventId] = useState(() => crypto.randomUUID());
  return (
    <section className="crm-detail">
      <h4>Confirmação manual auditada</h4>
      <p>
        Registar apenas o que confirmou na aplicação ou comprovativo. Não é um evento automático da
        API. Empresas simuladas permanecem simulações.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fact: ConversionFact = {
            eventId,
            appId: data.config.appId || 'manual-agexa',
            kind,
            occurredAt: new Date(occurred).toISOString(),
            accountId,
            evidence,
            ...(reference ? { reference } : {}),
            ...(kind === 'trial_started' || kind === 'trial_extended'
              ? { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() }
              : {}),
            ...(kind === 'payment_confirmed'
              ? { paymentId: receipt, amountMinor: Number(amount), currency, verified: confirmed }
              : {}),
          };
          act('conversion/manual', { companyId: company, fact, confirmed }, () => {
            setEventId(crypto.randomUUID());
            setEvidence('');
            setConfirmed(false);
          });
        }}
      >
        <label>
          Empresa da confirmação
          <select
            aria-label="Empresa da confirmação"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          >
            <option value="">Selecionar oportunidade</option>
            {office.snapshot?.crm?.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.recordMode}
              </option>
            ))}
          </select>
        </label>
        <label>
          ID da oportunidade
          <input value={company} onChange={(e) => setCompany(e.target.value)} required />
        </label>
        <label>
          Facto confirmado
          <select
            aria-label="Facto confirmado"
            value={kind}
            onChange={(e) => setKind(e.target.value as ConversionKind)}
          >
            {Object.entries(label).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          ID opaco da conta no sistema
          <input
            value={accountId}
            onChange={(e) => setAccount(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <label>
          Referência comercial, se comprovada
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label>
          Data efetiva do evento
          <input
            type="datetime-local"
            value={occurred}
            onChange={(e) => setOccurred(e.target.value)}
            required
          />
        </label>
        {(kind === 'trial_started' || kind === 'trial_extended') && (
          <>
            <label>
              Início efetivo do teste
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </label>
            <label>
              Término informado pelo sistema
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </label>
          </>
        )}
        {kind === 'payment_confirmed' && (
          <>
            <label>
              ID do recibo confirmado
              <input value={receipt} onChange={(e) => setReceipt(e.target.value)} required />
            </label>
            <label>
              Montante em unidades mínimas da moeda
              <input
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <label>
              Moeda ISO
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                required
              />
            </label>
          </>
        )}
        <label>
          Evidência independente
          <textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            required
            maxLength={1000}
          />
        </label>
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Confirmei este facto e a associação à empresa; o registo será identificado como manual.
        </label>
        <button disabled={!ready || !confirmed}>Registar facto confirmado</button>
      </form>
    </section>
  );
}
function HandoffDetail({ detail: d, act, ready }: { detail: Handoff; act: Act; ready: boolean }) {
  const [notes, setNotes] = useState(d.followup.notes),
    [follow, setFollow] = useState(
      d.followup.followupAt
        ? new Date(
            Date.parse(d.followup.followupAt) -
              new Date(d.followup.followupAt).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : '',
    ),
    [reason, setReason] = useState(d.followup.closedReason ?? ''),
    [msg, setMsg] = useState(''),
    [evidence, setEvidence] = useState('');
  return (
    <section className="crm-detail">
      <h4>NOVO CLIENTE INTERESSADO — ATENDIMENTO DO CEO</h4>
      <p>
        {d.company.name} · {d.company.sector} ·{' '}
        {d.company.recordMode === 'simulated' ? 'SIMULAÇÃO' : 'Dados comerciais'}
      </p>
      <p>Necessidades registadas: {d.company.needs || 'Não confirmadas'}</p>
      <p>Última mensagem recebida: {d.lastReceived?.body ?? 'Não disponível'}</p>
      <p>
        Link confirmado: {d.invite.sentUrl} · {date(d.invite.confirmedAt)} · preparado por{' '}
        {d.invite.employeeId}
      </p>
      <p>
        Cadastro:{' '}
        {d.account ? d.account.externalId + ' · ' + origin(d.account.origin) : 'Não confirmado'}
      </p>
      <h4>Argumentos efetivamente enviados</h4>
      {d.confirmedArguments.map((m, i) => (
        <p className="messaging-body" key={i}>
          {m.body}
        </p>
      ))}
      <h4>Objeções observadas e classificadas pelo CEO</h4>
      {d.observedObjections.map((m, i) => (
        <p key={i}>
          {m.body} · {m.evidence}
        </p>
      ))}
      {!d.observedObjections.length && (
        <p>Nenhuma mensagem foi classificada como objeção; não se presume que houve uma.</p>
      )}
      <label>
        Mensagem recebida com objeção
        <select
          aria-label="Mensagem recebida com objeção"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        >
          <option value="">Selecionar mensagem</option>
          {d.received.map((m) => (
            <option key={m.id} value={m.id}>
              {m.body.slice(0, 100)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Contexto da objeção
        <input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </label>
      <button
        disabled={!ready || !msg || !evidence}
        onClick={() => act('conversion/objections', { messageId: msg, evidence })}
      >
        Registar objeção observada
      </button>
      <p>Próxima ação: {d.nextAction}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(`conversion/handoffs/${d.followup.id}`, {
            notes,
            followupAt: follow ? new Date(follow).toISOString() : null,
            closedReason: reason || null,
          });
        }}
      >
        <label>
          Notas de acompanhamento
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label>
          Acompanhamento interno
          <input type="datetime-local" value={follow} onChange={(e) => setFollow(e.target.value)} />
        </label>
        <label>
          Motivo de encerramento, se não convertido
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button disabled={!ready}>Guardar acompanhamento</button>
      </form>
    </section>
  );
}
