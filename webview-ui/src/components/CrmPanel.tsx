import { useEffect, useState } from 'react';

import { EMPLOYEES } from '../../../core/src/agexa.js';
import type {
  BusinessChannel,
  CommercialSettings,
  Company,
  CompanyDetail,
  CompanyInput,
  PipelineStage,
} from '../../../core/src/crm.js';
import { PIPELINE } from '../../../core/src/crm.js';
import type { SalesOffice } from '../hooks/useSalesOffice.js';
import { serverToken } from '../transport/serverToken.js';
import { IntelligencePanel } from './IntelligencePanel.js';

export type CrmTab = 'prospecting' | 'crm' | 'workspace' | 'marketing' | 'reports' | 'commercial';
type Action = (route: string, body: unknown, done?: () => void) => void;
const date = (value: string): string =>
  new Date(value).toLocaleString('pt-MZ', { timeZone: 'Africa/Maputo' });
async function read<T>(path: string): Promise<T> {
  const response = await fetch(`/api/agexa/${path}`, {
    headers: { Authorization: `Bearer ${serverToken ?? ''}` },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw Error(data.error ?? 'Não foi possível consultar o CRM');
  return data;
}

export function CrmPanel({
  office,
  tab,
  act,
  ready,
}: {
  office: SalesOffice;
  tab: CrmTab;
  act: Action;
  ready: boolean;
}) {
  const crm = office.snapshot?.crm;
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState('');
  const [items, setItems] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
  const [city, setCity] = useState('');
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'table' | 'kanban'>('table');
  useEffect(() => {
    if (!crm) return;
    let alive = true;
    const query = new URLSearchParams({ search, sector, city, stage, page: String(page) });
    void read<{ items: Company[]; total: number }>(`crm/companies?${query}`)
      .then((data) => {
        if (alive) {
          setItems(data.items);
          setTotal(data.total);
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [crm, search, sector, city, stage, page]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    void read<CompanyDetail>(`crm/companies/${selected}`)
      .then((data) => {
        if (alive) setDetail(data);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [selected, crm]);
  if (!crm) return <p>Reinicie o backend com a Fase 4 para aceder ao CRM.</p>;
  return (
    <section className="crm-module">
      <h3>
        {
          {
            prospecting: 'Prospeção empresarial',
            crm: 'AGEXA Sales CRM',
            workspace: 'Sales Workspace · Nexus',
            marketing: 'Marketing Center',
            reports: 'Sales Analytics',
            commercial: 'Configurações comerciais',
          }[tab]
        }
      </h3>
      <p className="agexa-notice">
        Materiais internos. Não são enviadas mensagens externas. Adequação e consentimento são
        avaliações separadas.
      </p>
      {error && (
        <p role="alert" className="agexa-error">
          {error}
        </p>
      )}
      {tab === 'prospecting' && (
        <Prospecting office={office} act={act} ready={ready} error={setError} />
      )}
      {tab === 'workspace' && <Workspace office={office} act={act} ready={ready} />}
      {tab === 'reports' && <Reports office={office} />}
      {tab === 'commercial' && <Commercial office={office} act={act} ready={ready} />}
      {(tab === 'crm' || tab === 'marketing') && (
        <>
          <div className="crm-filters">
            <label>
              Pesquisar empresa
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              Filtrar setor
              <input
                value={sector}
                onChange={(e) => {
                  setSector(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              Filtrar cidade
              <input
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              Filtrar etapa
              <select
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todas</option>
                {PIPELINE.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="crm-actions">
            <span>{total} empresas registadas</span>
            <button onClick={() => setView(view === 'table' ? 'kanban' : 'table')}>
              {view === 'table' ? 'Ver Kanban' : 'Ver tabela'}
            </button>
            <button
              disabled={!ready}
              onClick={() => {
                void fetch('/api/agexa/crm/export', {
                  headers: { Authorization: `Bearer ${serverToken ?? ''}` },
                })
                  .then(async (r) => {
                    if (!r.ok) throw Error('Exportação recusada');
                    const blob = await r.blob();
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'agexa-empresas.csv';
                    link.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch((e: Error) => setError(e.message));
              }}
            >
              Exportar CSV
            </button>
          </div>
          {view === 'kanban' ? (
            <div className="crm-kanban" aria-label="Pipeline comercial">
              {PIPELINE.map(([key, label]) => (
                <section className="crm-column" key={key}>
                  <h4>{label}</h4>
                  {items
                    .filter((c) => c.stage === key)
                    .map((company) => (
                      <button
                        className="crm-lead"
                        key={company.id}
                        onClick={() => setSelected(company.id)}
                      >
                        <strong>{company.name}</strong>
                        <small>
                          {company.city} · {company.score ?? '—'}/100
                        </small>
                        <span>
                          {company.eligibility.allowed
                            ? 'Contacto autorizado'
                            : 'Sem autorização de contacto'}
                        </span>
                      </button>
                    ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="crm-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Setor / cidade</th>
                    <th>Adequação</th>
                    <th>Contacto</th>
                    <th>Etapa</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((company) => (
                    <tr key={company.id}>
                      <td>
                        <button onClick={() => setSelected(company.id)}>{company.name}</button>
                      </td>
                      <td>
                        {company.sector}
                        <br />
                        {company.city}
                      </td>
                      <td>{company.score ?? 'Não avaliada'}</td>
                      <td>{company.eligibility.allowed ? 'Autorizado' : 'Não autorizado'}</td>
                      <td>{PIPELINE.find(([key]) => key === company.stage)?.[1]}</td>
                      <td>
                        {company.recordMode}
                        <br />
                        {date(company.discoveredAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!items.length && (
            <p>Nenhuma empresa neste filtro. Importe dados autorizados em Prospeção.</p>
          )}
          <div className="crm-actions">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Página anterior
            </button>
            <span>Página {page} · até 50 registos</span>
            <button disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>
              Página seguinte
            </button>
          </div>
          {detail && (
            <LeadDetail
              key={detail.company.id}
              detail={detail}
              office={office}
              act={act}
              ready={ready}
              error={setError}
              close={() => setSelected('')}
            />
          )}
          {tab === 'marketing' && !detail && (
            <p>
              Escolha uma empresa para preparar, comparar e rever versões de rascunhos. Uma
              simulação Luna nunca regista uma conversa real.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Prospecting({
  office,
  act,
  ready,
  error,
}: {
  office: SalesOffice;
  act: Action;
  ready: boolean;
  error: (text: string) => void;
}) {
  const crm = office.snapshot!.crm!;
  const [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'manual' | 'csv' | 'website'>('csv');
  const [url, setUrl] = useState('');
  const [terms, setTerms] = useState('');
  const [evidence, setEvidence] = useState('');
  const [attribution, setAttribution] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [payload, setPayload] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [businessOnly, setBusinessOnly] = useState(false);
  const [simulated, setSimulated] = useState(false);
  useEffect(() => {
    if (!sourceId && crm.sources.length) setSourceId(crm.sources[0].id);
  }, [crm.sources, sourceId]);
  const source = crm.sources.find((s) => s.id === sourceId);
  return (
    <>
      <details>
        <summary>Adicionar fonte autorizada</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(
              'crm/sources',
              {
                name,
                kind,
                url: url || null,
                termsUrl: terms || null,
                permissionEvidence: evidence,
                attribution,
                enabled: true,
                termsReviewed: reviewed,
                commercialReuseAllowed: reviewed,
              },
              () => {
                setName('');
                setSourceId('');
              },
            );
          }}
        >
          <label>
            Nome da fonte
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Tipo de fonte
            <select
              aria-label="Tipo de fonte"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="csv">CSV autorizado</option>
              <option value="manual">Lista do CEO</option>
              <option value="website">Website empresarial autorizado</option>
            </select>
          </label>
          <label>
            URL empresarial da fonte
            <input
              type="url"
              required={kind === 'website'}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label>
            URL dos termos, quando disponível
            <input type="url" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </label>
          <label>
            Origem e evidência de autorização
            <textarea
              required
              maxLength={2000}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <label>
            Atribuição exigida pela fonte
            <input value={attribution} onChange={(e) => setAttribution(e.target.value)} />
          </label>
          <label className="agexa-check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            Verifiquei os termos e a permissão de reutilização comercial.
          </label>
          <button disabled={!ready || !reviewed}>Guardar fonte</button>
        </form>
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          error('');
          try {
            const body: Record<string, unknown> = { sourceId, authorized, businessOnly, simulated };
            if (source?.kind === 'csv') body.csv = payload;
            else if (source?.kind === 'website') body.company = JSON.parse(payload);
            else body.records = JSON.parse(payload);
            act('crm/import', body);
          } catch {
            error('Introduza JSON válido para a lista ou ficha empresarial.');
          }
        }}
      >
        <label>
          Fonte disponível
          <select
            aria-label="Fonte disponível"
            required
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setPayload('');
            }}
          >
            <option value="">Selecionar fonte</option>
            {crm.sources.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name} · {s.kind}
                {s.enabled ? '' : ' · pausada'}
              </option>
            ))}
          </select>
        </label>
        {source && (
          <>
            <p>{source.permissionEvidence}</p>
            <p className="agexa-subtle">
              Atribuição: {source.attribution || 'não indicada pelo proprietário da fonte'}
            </p>
            <button
              type="button"
              disabled={!ready}
              onClick={() => act(`crm/sources/${source.id}`, { enabled: !source.enabled })}
            >
              {source.enabled ? 'Pausar fonte' : 'Ativar fonte'}
            </button>
          </>
        )}
        {source?.kind === 'csv' && (
          <label>
            Ficheiro CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 48000) {
                  error('CSV limitado a 48 KB');
                  return;
                }
                void file.text().then(setPayload);
              }}
            />
          </label>
        )}
        <label>
          {source?.kind === 'csv' ? 'Conteúdo CSV' : 'Empresas em JSON'}
          <textarea
            required
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder={
              source?.kind === 'csv'
                ? 'name,sector,city,country\nEmpresa,barbearia,Beira,Moçambique'
                : source?.kind === 'website'
                  ? '{"name":"Empresa","website":"https://empresa.example.org/","city":"Beira"}'
                  : '[{"name":"Empresa","sector":"barbearia","city":"Beira","country":"Moçambique"}]'
            }
          />
        </label>
        <p className="agexa-subtle">
          CSV: até {crm.settings.maxImportRows} empresas / 48 KB. Campos: name, sector, city,
          province, country, website, businessPage, contactChannel, businessContact, needs,
          usesAppointments, organizationNeed, hasSchedulingSystem, sufficientInfo.
        </p>
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
          />
          Autorizo a importação/análise desta fonte.
        </label>
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={businessOnly}
            onChange={(e) => setBusinessOnly(e.target.checked)}
          />
          São apenas dados empresariais autorizados, sem recolha indiscriminada de pessoas.
        </label>
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={simulated}
            onChange={(e) => setSimulated(e.target.checked)}
          />
          Estes registos são simulação e devem ficar separados das métricas reais.
        </label>
        <button disabled={!ready || !source?.enabled || !authorized || !businessOnly}>
          Executar Hunter
        </button>
      </form>
      <p className="agexa-notice">
        CSV e listas funcionam sem IA. Websites exigem fonte autorizada, HTTPS, DNS público fixo e
        robots.txt permitido. O proxy deste ambiente pode impedir a análise segura; nesse caso a
        tarefa regista a limitação e não inventa empresas. Google Maps, Instagram e Facebook não são
        fontes de extração automática.
      </p>
      <h3>Resultados de importação</h3>
      {crm.batches.map((batch) => (
        <article className="agexa-task" key={batch.id}>
          <strong>
            {crm.sources.find((s) => s.id === batch.sourceId)?.name} · {batch.status}
          </strong>
          <p>{date(batch.createdAt)}</p>
          {batch.result && <pre>{JSON.stringify(batch.result, null, 2)}</pre>}
        </article>
      ))}
    </>
  );
}

function LeadDetail({
  detail,
  office,
  act,
  ready,
  error,
  close,
}: {
  detail: CompanyDetail;
  office: SalesOffice;
  act: Action;
  ready: boolean;
  error: (s: string) => void;
  close: () => void;
}) {
  const c = detail.company;
  const [stage, setStage] = useState<PipelineStage>(c.stage);
  const [evidence, setEvidence] = useState('');
  const [verified, setVerified] = useState(false);
  const [origin, setOrigin] = useState('');
  const [consentEvidence, setConsentEvidence] = useState('');
  const [consentStatus, setConsentStatus] = useState('granted');
  const [channel, setChannel] = useState<BusinessChannel>(
    c.contactChannel === 'none' ? 'email' : c.contactChannel,
  );
  const [useAI, setUseAI] = useState(false);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [body, setBody] = useState('');
  return (
    <article className="crm-detail" aria-label="Ficha da empresa">
      <div className="agexa-panel-heading">
        <h3>{c.name}</h3>
        <button onClick={close}>Fechar ficha</button>
      </div>
      <p>
        {c.sector || 'Setor desconhecido'} · {c.city || 'Cidade desconhecida'} · {c.province} ·{' '}
        {c.country || 'País desconhecido'}
      </p>
      <p>
        Origem: {detail.source.name} · {c.recordMode} · {date(c.discoveredAt)}
      </p>
      <p>Atribuição: {detail.source.attribution || 'não indicada'}</p>
      <p>
        {c.website && (
          <a href={c.website} target="_blank" rel="noreferrer">
            Website empresarial
          </a>
        )}
      </p>
      <p>
        <strong>Adequação: {c.score === null ? 'não avaliada' : `${c.score}/100`}</strong> ·{' '}
        <strong>{c.eligibility.allowed ? 'Contacto autorizado' : 'Contacto não autorizado'}</strong>
      </p>
      <p>{c.scoreReason}</p>
      <p>{c.eligibility.reason}</p>
      <p>
        Necessidades: {c.needs || 'não confirmadas'} · próxima ação: {c.nextAction || 'a definir'}
      </p>
      <p>
        Última interação real registada: {c.lastInteraction ? date(c.lastInteraction) : 'nenhuma'}
      </p>
      <label>
        Funcionário responsável
        <select
          aria-label="Funcionário responsável"
          value={c.owner}
          disabled={!ready}
          onChange={(e) => act(`crm/companies/${c.id}/owner`, { employeeId: e.target.value })}
        >
          {EMPLOYEES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>Editar necessidades, dados empresariais e factos</summary>
        <CompanyEditor key={c.updatedAt} company={c} ready={ready} error={error} />
      </details>
      <section>
        <h4>Avaliação e materiais</h4>
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={useAI}
            disabled={!office.snapshot?.inference.connected}
            onChange={(e) => setUseAI(e.target.checked)}
          />
          Utilizar inferência disponível (caso contrário, regras e roteiros identificados).
        </label>
        <div className="crm-actions">
          {(
            [
              ['atlas', 'Qualificar com Atlas'],
              ['maya', 'Preparar abordagem Maya'],
              ['luna', 'Simular conversa Luna'],
              ['victor', 'Preparar objeções Victor'],
              ['sophia', 'Preparar convite Sophia'],
            ] as const
          ).map(([employeeId, label]) => (
            <button
              key={employeeId}
              disabled={!ready}
              onClick={() => act(`crm/companies/${c.id}/work`, { employeeId, useAI })}
            >
              {label}
            </button>
          ))}
        </div>
        {detail.qualifications.map((q) => (
          <details key={q.id}>
            <summary>
              {q.mode} · {q.score ?? 'análise narrativa'} · {date(q.createdAt)}
            </summary>
            <p>{q.reason}</p>
            <pre>{JSON.stringify(q.criteria, null, 2)}</pre>
          </details>
        ))}
      </section>
      <details>
        <summary>Consentimento por canal</summary>
        <p>Um contacto publicado não é autorização para publicidade.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(`crm/companies/${c.id}/consent`, {
              channel,
              status: consentStatus,
              evidence: consentEvidence,
              origin,
            });
          }}
        >
          <label>
            Canal do consentimento
            <select
              aria-label="Canal do consentimento"
              value={channel}
              onChange={(e) => setChannel(e.target.value as BusinessChannel)}
            >
              {['website', 'email', 'whatsapp', 'business_phone'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Decisão de contacto
            <select
              aria-label="Decisão de contacto"
              value={consentStatus}
              onChange={(e) => setConsentStatus(e.target.value)}
            >
              <option value="granted">Autorizado explicitamente</option>
              <option value="revoked">Revogado</option>
              <option value="denied">Recusado</option>
            </select>
          </label>
          <label>
            Origem do consentimento
            <input required value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </label>
          <label>
            Evidência do consentimento
            <textarea
              required
              value={consentEvidence}
              onChange={(e) => setConsentEvidence(e.target.value)}
            />
          </label>
          <button disabled={!ready}>Registar consentimento</button>
        </form>
        {detail.consents.map((record) => (
          <p key={record.id}>
            {record.channel}: {record.status} · {record.origin} · {record.evidence}
          </p>
        ))}
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(`crm/companies/${c.id}/stage`, {
            stage,
            ...(verified
              ? {
                  verification: {
                    independentlyVerified: true,
                    evidence,
                    occurredAt: new Date().toISOString(),
                  },
                }
              : {}),
          });
        }}
      >
        <label>
          Nova etapa
          <select
            aria-label="Nova etapa"
            value={stage}
            onChange={(e) => setStage(e.target.value as PipelineStage)}
          >
            {PIPELINE.map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          Tenho evidência independente deste evento real.
        </label>
        <label>
          Evidência externa / referência do registo
          <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        </label>
        <button disabled={!ready}>Guardar etapa</button>
      </form>
      <p className="agexa-subtle">
        Conversa, interesse, envio, conta, teste e pagamento exigem evidência confirmada
        manualmente. A aplicação não os confirma através de WhatsApp, Base44 ou pagamentos nesta
        fase.
      </p>
      <div className="crm-actions">
        <button disabled={!ready} onClick={() => act(`crm/companies/${c.id}/handoff`, {})}>
          Preparar handoff interno
        </button>
        <button onClick={() => setApprovedOnly(!approvedOnly)}>
          {approvedOnly ? 'Ver todas as versões' : 'Comparar versões aprovadas'}
        </button>
      </div>
      <div className="crm-drafts">
        {detail.drafts
          .filter((d) => !approvedOnly || d.status === 'approved')
          .map((d) => (
            <article key={d.id} className="agexa-task">
              <h4>
                {d.employeeId} · {d.kind} v{d.version}
              </h4>
              <p>
                {d.mode} · {d.status} · APENAS INTERNO
              </p>
              <pre>{d.body}</pre>
              <div className="crm-actions">
                <button
                  disabled={!ready}
                  onClick={() => act(`crm/drafts/${d.id}/review`, { status: 'approved' })}
                >
                  Aprovar versão {d.version}
                </button>
                <button
                  disabled={!ready}
                  onClick={() => act(`crm/drafts/${d.id}/review`, { status: 'rejected' })}
                >
                  Rejeitar
                </button>
              </div>
            </article>
          ))}
      </div>
      <details>
        <summary>Guardar abordagem manual</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(
              `crm/companies/${c.id}/drafts`,
              { employeeId: 'maya', kind: 'approach', body },
              () => setBody(''),
            );
          }}
        >
          <label>
            Rascunho manual
            <textarea required value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <button disabled={!ready}>Guardar nova versão manual</button>
        </form>
      </details>
      {detail.handoffs.map((h) => (
        <details key={h.id}>
          <summary>Handoff: {h.status} · não concluído</summary>
          <pre>{h.summary}</pre>
        </details>
      ))}
      <details>
        <summary>Histórico e auditoria</summary>
        {detail.activities.map((a) => (
          <article key={a.id} className="agexa-event">
            <strong>
              {a.actor} · {a.action}
            </strong>
            <small>{date(a.createdAt)}</small>
            <pre>{a.detail}</pre>
          </article>
        ))}
      </details>
    </article>
  );
}
function CompanyEditor({
  company: c,
  ready,
  error,
}: {
  company: Company;
  ready: boolean;
  error: (s: string) => void;
}) {
  const [value, setValue] = useState<CompanyInput>({
    name: c.name,
    sector: c.sector,
    city: c.city,
    province: c.province,
    country: c.country,
    website: c.website,
    businessPage: c.businessPage,
    contactChannel: c.contactChannel,
    businessContact: c.businessContact,
    needs: c.needs,
    nextAction: c.nextAction,
    ...c.facts,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void fetch(`/api/agexa/crm/companies/${c.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${serverToken ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(value),
        })
          .then(async (r) => {
            if (!r.ok) {
              const data = await r.json();
              throw Error(data.error ?? 'Alteração recusada');
            }
          })
          .catch((e: Error) => error(e.message));
      }}
    >
      <p>Nome, cidade e país identificam esta empresa e permanecem preservados.</p>
      {(
        [
          ['sector', 'Setor'],
          ['province', 'Província'],
          ['website', 'Website'],
          ['businessPage', 'Página empresarial'],
          ['businessContact', 'Contacto empresarial'],
          ['needs', 'Necessidades identificadas'],
          ['nextAction', 'Próxima ação'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            value={value[key] ?? ''}
            onChange={(e) => setValue({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Canal empresarial
        <select
          aria-label="Canal empresarial"
          value={value.contactChannel}
          onChange={(e) =>
            setValue({ ...value, contactChannel: e.target.value as BusinessChannel })
          }
        >
          {['none', 'website', 'email', 'whatsapp', 'business_phone'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {(
        [
          ['usesAppointments', 'Usa marcações'],
          ['organizationNeed', 'Necessidade comprovada'],
          ['hasSchedulingSystem', 'Tem sistema de agendamento'],
          ['sufficientInfo', 'Informação suficiente'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <select
            aria-label={label}
            value={value[key] === null ? 'unknown' : value[key] ? 'true' : 'false'}
            onChange={(e) =>
              setValue({
                ...value,
                [key]: e.target.value === 'unknown' ? null : e.target.value === 'true',
              })
            }
          >
            <option value="unknown">Desconhecido</option>
            <option value="true">Sim, confirmado</option>
            <option value="false">Não, confirmado</option>
          </select>
        </label>
      ))}
      <button disabled={!ready}>Guardar dados empresariais</button>
    </form>
  );
}
function Workspace({ office, act, ready }: { office: SalesOffice; act: Action; ready: boolean }) {
  const crm = office.snapshot!.crm!;
  const [sourceId, setSourceId] = useState('');
  const [goal, setGoal] = useState('');
  const [city, setCity] = useState('Beira');
  const [sector, setSector] = useState('barbearia');
  const [useAI, setUseAI] = useState(false);
  return (
    <section>
      <p>
        Hunter pesquisa os registos já importados da fonte escolhida. Para novas empresas, importe
        CSV/listas em Prospeção primeiro. Os filtros são parâmetros explícitos; não é alegada
        pesquisa online.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act('crm/orders', { goal, sourceId, sector, city, useAI });
        }}
      >
        <label>
          Objetivo comercial Nexus
          <textarea
            required
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Encontra oportunidades na Beira e prepara materiais comerciais."
          />
        </label>
        <label>
          Fonte de pesquisa autorizada
          <select
            aria-label="Fonte de pesquisa autorizada"
            required
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">Selecionar fonte</option>
            {crm.sources
              .filter((s) => s.enabled)
              .map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <div className="crm-filters">
          <label>
            Setor a pesquisar
            <input value={sector} onChange={(e) => setSector(e.target.value)} />
          </label>
          <label>
            Cidade a pesquisar
            <input value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
        </div>
        <label className="agexa-check">
          <input
            type="checkbox"
            disabled={!office.snapshot?.inference.connected}
            checked={useAI}
            onChange={(e) => setUseAI(e.target.checked)}
          />
          Usar Ollama verificado para plano e materiais; sem IA, apenas operações por regras
          identificadas.
        </label>
        <button disabled={!ready || office.snapshot!.suspended}>Propor operação comercial</button>
      </form>
      {crm.orders.map((order) => {
        const tasks = office.snapshot!.tasks.filter(
          (t) => (t.input.crm as { orderId?: string } | undefined)?.orderId === order.id,
        );
        const plan = office.snapshot!.tasks.find((t) => t.id === order.planTaskId);
        return (
          <article key={order.id} className="agexa-task">
            <h4>{order.goal}</h4>
            <p>
              {order.status} · {order.city} / {order.sector} ·{' '}
              {order.useAI ? 'inferência solicitada' : 'regras, sem inferência'}
            </p>
            <small>
              Orçamento: {order.taskBudget} tarefas / {order.inferenceBudget} inferências
            </small>
            {plan?.result && <pre>{JSON.stringify(plan.result, null, 2)}</pre>}
            {order.status === 'proposed' && (
              <button
                disabled={!ready || plan?.status !== 'completed'}
                onClick={() => act(`crm/orders/${order.id}/approve`, {})}
              >
                Aprovar operação comercial
              </button>
            )}
            {!['completed', 'cancelled'].includes(order.status) && (
              <button disabled={!ready} onClick={() => act(`crm/orders/${order.id}/cancel`, {})}>
                Cancelar operação comercial
              </button>
            )}
            {tasks.map((task) => (
              <details key={task.id}>
                <summary>
                  {task.employeeId} · {task.status} · {task.objective}
                </summary>
                <p>Dependências: {task.dependencyIds?.join(', ') || 'nenhuma'}</p>
                {task.error && <p className="agexa-error">{task.error}</p>}
                {task.result && <pre>{JSON.stringify(task.result, null, 2)}</pre>}
              </details>
            ))}
          </article>
        );
      })}
    </section>
  );
}
function Reports({ office }: { office: SalesOffice }) {
  const data = office.snapshot!.crm!.analytics;
  const stats = [
    ['Empresas registadas', data.companies],
    ['Qualificadas', data.qualified],
    ['Alta prioridade', data.highPriority],
    ['Contactos autorizados', data.authorizedContacts],
    ['Rascunhos internos', data.drafts],
    ['Versões aprovadas', data.approvedDrafts],
    ['Oportunidades em curso', data.opportunities],
    ['Contas com evidência manual', data.confirmedAccounts],
    ['Testes com evidência manual', data.confirmedTrials],
    ['Pagantes com evidência manual', data.confirmedPaying],
    ['Mensagens enviadas por integração', data.sentMessages],
    ['Receita confirmada', data.revenue],
  ] as const;
  return (
    <section>
      <div className="crm-metrics">
        {stats.map(([label, value]) => (
          <article key={label}>
            <strong>{value === null ? 'Não disponível' : value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </div>
      <p>{data.provenance}</p>
      <p>
        Dados simulados separados: {data.simulatedCompanies}. Rascunhos e links preparados não
        contam como envios.
      </p>
      <h4>Pipeline dos registos</h4>
      {PIPELINE.map(([key, label]) => (
        <div className="crm-bar" key={key}>
          <span>{label}</span>
          <meter
            aria-label={label}
            min={0}
            max={Math.max(1, data.companies)}
            value={data.stages[key] ?? 0}
          />
          <strong>{data.stages[key] ?? 0}</strong>
        </div>
      ))}
      <h4>Fontes utilizadas</h4>
      {data.sources.map((s, index) => (
        <p key={index}>
          {s.name}: {s.count} registos
        </p>
      ))}
      <h4>Desempenho operacional</h4>
      {data.agents.map((a) => (
        <div className="crm-bar" key={a.employeeId}>
          <span>{a.employeeId}</span>
          <meter
            aria-label={`Tarefas de ${a.employeeId}`}
            min={0}
            max={Math.max(1, ...data.agents.map((x) => x.completed))}
            value={a.completed}
          />
          <span>
            {a.completed} concluídas · {a.errors} erros
          </span>
        </div>
      ))}
    </section>
  );
}
function Commercial({ office, act, ready }: { office: SalesOffice; act: Action; ready: boolean }) {
  const [value, setValue] = useState<CommercialSettings>(office.snapshot!.crm!.settings);
  return (
    <section>
      <p>
        AGEXA_SIGNUP_URL, AGEXA_FREE_TRIAL_ENABLED e AGEXA_FREE_TRIAL_DAYS=7 usam a mesma base
        confirmada da Central IA; não existem valores duplicados.
      </p>
      <IntelligencePanel office={office} tab="knowledge" act={act} ready={ready} />
      <h4>Prioridades e limites</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act('crm/settings', {
            ...value,
            prioritySectors: value.prioritySectors.map((s) => s.trim()).filter(Boolean),
            priorityCities: value.priorityCities.map((s) => s.trim()).filter(Boolean),
          });
        }}
      >
        {(
          [
            ['prioritySectors', 'Setores prioritários'],
            ['priorityCities', 'Cidades prioritárias'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              value={value[key].join('\n')}
              onChange={(e) => setValue({ ...value, [key]: e.target.value.split('\n') })}
            />
          </label>
        ))}
        {(
          [
            ['qualificationThreshold', 'Pontuação mínima de qualificação', 0, 100],
            ['maxImportRows', 'Empresas por importação', 1, 200],
            ['maxResearchPerHour', 'Pesquisas/importações por hora e fonte', 1, 30],
            ['maxCampaignLeads', 'Empresas com materiais por operação', 1, 3],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min}
              max={max}
              value={value[key]}
              onChange={(e) => setValue({ ...value, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <label>
          Política de contacto
          <textarea
            value={value.contactPolicy}
            onChange={(e) => setValue({ ...value, contactPolicy: e.target.value })}
          />
        </label>
        <button disabled={!ready}>Guardar configurações comerciais</button>
      </form>
    </section>
  );
}
