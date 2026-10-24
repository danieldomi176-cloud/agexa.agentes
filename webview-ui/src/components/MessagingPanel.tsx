import { useEffect, useState } from 'react';

import type { EmployeeId } from '../../../core/src/agexa.js';
import { EMPLOYEES } from '../../../core/src/agexa.js';
import type {
  MessagingConversation,
  MessagingDetail,
  MessagingDraft,
  MessagingProviderId,
} from '../../../core/src/messaging.js';
import type { SalesOffice } from '../hooks/useSalesOffice.js';
import { serverToken } from '../transport/serverToken.js';
type Act = (route: string, body: unknown, done?: () => void) => void;
type Detail = MessagingDetail & {
  deliveries: { id: string; status: string; draftId: string; providerId: string | null }[];
};
async function read<T>(route: string): Promise<T> {
  const r = await fetch('/api/agexa/' + route, {
    headers: { Authorization: `Bearer ${serverToken ?? ''}` },
  });
  if (!r.ok) throw Error('Não foi possível carregar os dados privados do canal');
  return r.json() as Promise<T>;
}
export function MessagingPanel({
  office,
  act,
  ready,
}: {
  office: SalesOffice;
  act: Act;
  ready: boolean;
}) {
  const snapshot = office.snapshot?.messaging;
  const [items, setItems] = useState<MessagingConversation[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState(''),
    [selected, setSelected] = useState(''),
    [messagePage, setMessagePage] = useState(1);
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState('');
  const [provider, setProvider] = useState<MessagingProviderId>('web_experimental'),
    [confirmExperimental, setConfirmExperimental] = useState(false),
    [configOpen, setConfigOpen] = useState(false);
  const [qr, setQr] = useState<{ image: string; expiresAt: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (snapshot)
      void read<{ items: MessagingConversation[]; total: number }>(
        `messaging/conversations?search=${encodeURIComponent(search)}&state=${filter}&page=${page}`,
      )
        .then((r) => {
          if (active) {
            setItems(r.items);
            setTotal(r.total);
          }
        })
        .catch((e: Error) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [snapshot, search, filter, page]);
  useEffect(() => {
    let active = true;
    if (selected)
      void read<Detail>(`messaging/conversations/${selected}?page=${messagePage}`)
        .then((d) => {
          if (active) setDetail(d);
        })
        .catch((e: Error) => {
          if (active) setError(e.message);
        });
    else setDetail(null);
    return () => {
      active = false;
    };
  }, [snapshot, selected, messagePage]);
  useEffect(() => {
    let active = true;
    if (snapshot?.connection.qrAvailable)
      void read<{ image: string; expiresAt: string }>('messaging/qr')
        .then((r) => {
          if (active) setQr(r);
        })
        .catch(() => {
          if (active) setQr(null);
        });
    else setQr(null);
    return () => {
      active = false;
    };
  }, [snapshot]);
  if (!snapshot) return <p>Reiniciar o backend atualizado para abrir o WhatsApp Center.</p>;
  const c = snapshot.connection;
  return (
    <section className="messaging-center">
      <h3>AGEXA WHATSAPP SALES CENTER</h3>
      <p className="agexa-notice">
        {c.simulated
          ? 'CANAL SIMULADO — sem conta nem mensagens reais.'
          : 'Envios individuais sujeitos a aprovação humana. Sem disparos nem contacto a números prospetados.'}
      </p>
      <p>
        <strong>Ligação: {c.status}</strong> · Provider: {c.provider} ·{' '}
        {c.suspended ? 'Canal suspenso' : 'Canal habilitado'}
        {c.account && ` · Conta: ${c.account}`}
      </p>
      {c.error && (
        <p className="agexa-error" role="alert">
          {c.error}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="crm-actions">
        <button onClick={() => setConfigOpen(!configOpen)}>Configurar canal</button>
        <button
          disabled={!ready || !['disconnected', 'disabled', 'error'].includes(c.status)}
          onClick={() =>
            act('messaging/connection', {
              action: 'connect',
              confirmedExperimental: confirmExperimental,
            })
          }
        >
          Ligar canal
        </button>
        <button
          disabled={!ready}
          onClick={() =>
            act('messaging/connection', { action: 'disconnect', confirmedExperimental: false })
          }
        >
          Desligar canal
        </button>
        <button
          disabled={!ready}
          onClick={() => {
            if (
              window.confirm(
                'Revogar e eliminar a sessão local? Verifique também os dispositivos associados no telefone.',
              )
            )
              act('messaging/connection', { action: 'revoke', confirmedExperimental: false });
          }}
        >
          Revogar sessão
        </button>
        <button
          disabled={!ready}
          onClick={() => act('messaging/suspension', { suspended: !c.suspended })}
        >
          {c.suspended ? 'Retomar canal' : 'Suspender canal'}
        </button>
      </div>
      {configOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act('messaging/config', { provider, confirmedExperimental: confirmExperimental });
          }}
        >
          <label>
            Provider WhatsApp
            <select
              aria-label="Provider WhatsApp"
              value={provider}
              onChange={(e) => setProvider(e.target.value as MessagingProviderId)}
            >
              <option value="web_experimental">WhatsApp Web experimental (não oficial)</option>
              <option value="cloud_api">API oficial — contrato futuro</option>
              <option value="none">Desativado</option>
              {c.simulated && <option value="mock">Mock exclusivo de testes</option>}
            </select>
          </label>
          <button disabled={!ready}>Guardar configuração do canal</button>
        </form>
      )}
      <label className="agexa-check">
        <input
          type="checkbox"
          checked={confirmExperimental}
          onChange={(e) => setConfirmExperimental(e.target.checked)}
        />
        Confirmo cliente não oficial, risco de bloqueio e utilização exclusiva de um número de
        testes.
      </label>
      {c.limitations.map((text) => (
        <p className="agexa-subtle" key={text}>
          {text}
        </p>
      ))}
      <label>
        Modo de atendimento
        <select
          aria-label="Modo de atendimento"
          value={c.mode}
          disabled={!ready}
          onChange={(e) => act('messaging/mode', { mode: e.target.value })}
        >
          <option value="manual">Manual</option>
          <option value="assisted">Assistido — aprovação por mensagem</option>
          <option value="automatic">Automático — sujeito a verificações</option>
        </select>
      </label>
      <p className="agexa-subtle">
        Modo automático bloqueado nesta fase. Sem Ollama, usar rascunhos manuais ou material por
        regras, identificado como tal.
      </p>
      {qr && (
        <figure className="messaging-qr">
          <img src={qr.image} alt="QR privado para associar número de testes" />
          <figcaption>
            QR privado · expira às {new Date(qr.expiresAt).toLocaleTimeString()}. No telefone:
            Dispositivos associados → Associar dispositivo. Não partilhe esta imagem.
          </figcaption>
        </figure>
      )}
      <details>
        <summary>Indicadores do canal</summary>
        <p>
          {snapshot.metrics.realConversations} conversas reais ·{' '}
          {snapshot.metrics.simulatedConversations} simuladas ·{' '}
          {snapshot.metrics.confirmedRealSends} envios reais confirmados ·{' '}
          {snapshot.metrics.confirmedSimulatedSends} envios simulados confirmados ·{' '}
          {snapshot.metrics.reconciliation} a reconciliar
        </p>
      </details>
      <div className="crm-filters">
        <label>
          Pesquisar conversa
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Estado da conversa
          <select
            aria-label="Estado da conversa"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="open">Aberta</option>
            <option value="human">Atendimento humano</option>
            <option value="opted_out">Não contactar</option>
            <option value="reconciliation">Reconciliação</option>
          </select>
        </label>
      </div>
      <h4>Caixa de entrada · {total} conversas</h4>
      <div className="messaging-inbox">
        <div className="messaging-list">
          {items.map((item) => (
            <button
              key={item.id}
              aria-pressed={selected === item.id}
              onClick={() => {
                setSelected(item.id);
                setMessagePage(1);
              }}
            >
              <strong>{item.name || item.remoteId.split('@')[0]}</strong>
              <small>
                {item.owner} · {item.state} · {item.simulated ? 'SIMULADO' : 'Recebido do canal'}
              </small>
              <span>{item.lastMessage}</span>
            </button>
          ))}
          {!items.length && (
            <p>
              Sem mensagens recebidas neste provider. Nenhum contacto é criado a partir de listas de
              prospeção.
            </p>
          )}
        </div>
        <div>
          {detail && detail.conversation.id === selected ? (
            <Conversation
              key={detail.conversation.id}
              detail={detail}
              office={office}
              act={act}
              ready={ready}
              messagePage={messagePage}
              setMessagePage={setMessagePage}
            />
          ) : (
            <p>Selecione uma conversa recebida.</p>
          )}
        </div>
      </div>
      <div className="crm-actions">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Conversas anteriores
        </button>
        <span>Página {page}</span>
        <button disabled={page * 30 >= total} onClick={() => setPage(page + 1)}>
          Próximas conversas
        </button>
      </div>
      <details>
        <summary>Notificações e erros do canal</summary>
        {snapshot.notifications.map((e) => (
          <p key={e.id}>
            {new Date(e.createdAt).toLocaleString()} · {e.action} · {e.detail}
          </p>
        ))}
      </details>
    </section>
  );
}
function Conversation({
  detail,
  office,
  act,
  ready,
  messagePage,
  setMessagePage,
}: {
  detail: Detail;
  office: SalesOffice;
  act: Act;
  ready: boolean;
  messagePage: number;
  setMessagePage: (p: number) => void;
}) {
  const c = detail.conversation;
  const [company, setCompany] = useState(c.companyId ?? ''),
    [body, setBody] = useState(''),
    [kind, setKind] = useState<'reply' | 'invitation'>('reply');
  const [notes, setNotes] = useState(c.notes),
    [useAI, setUseAI] = useState(false),
    [employee, setEmployee] = useState<EmployeeId>('luna');
  const [evidence, setEvidence] = useState(''),
    [message, setMessage] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const [reconcileEvidence, setReconcileEvidence] = useState('');
  const companies = office.snapshot?.crm?.companies ?? [];
  return (
    <article className="messaging-conversation">
      <h4>
        {c.name || 'Conversa empresarial'} · {c.simulated ? 'SIMULAÇÃO' : 'Canal real'}
      </h4>
      <p>
        Contacto: {c.remoteId.split('@')[0]} · Responsável: {c.owner} · {c.state}
      </p>
      {!c.simulated && (
        <a href={`https://wa.me/${c.remoteId.split('@')[0]}`} target="_blank" rel="noreferrer">
          Abrir conversa no WhatsApp Business
        </a>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(`messaging/conversations/${c.id}/company`, { companyId: company });
        }}
      >
        <label>
          Empresa CRM
          <select
            aria-label="Empresa CRM"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          >
            <option value="">Selecionar empresa</option>
            {companies.map((co) => (
              <option key={co.id} value={co.id}>
                {co.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          ID da empresa CRM
          <input value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
        <button disabled={!ready || !company}>Associar empresa explicitamente</button>
      </form>
      {c.companyId && (
        <p>
          Consentimento é consultado no CRM a cada aprovação/envio. Um número público não é
          autorização.
        </p>
      )}
      <div className="crm-actions">
        <button
          disabled={!ready}
          onClick={() => act(`messaging/conversations/${c.id}/owner`, { owner: 'ceo' })}
        >
          Transferir para CEO
        </button>
        <button
          disabled={!ready || c.state !== 'human'}
          onClick={() => act(`messaging/conversations/${c.id}/owner`, { owner: 'luna' })}
        >
          Devolver explicitamente à Luna
        </button>
      </div>
      <h4>Histórico de mensagens</h4>
      <div className="messaging-history" aria-label="Histórico da conversa">
        {detail.messages.map((m) => (
          <article key={m.id} className={`messaging-message ${m.direction}`}>
            <small>
              {m.direction === 'inbound' ? 'Recebida' : 'Saída'} · {m.status} ·{' '}
              {m.simulated ? 'SIMULADA' : 'Provider real'} ·{' '}
              {new Date(m.createdAt).toLocaleString()}
            </small>
            <p>{m.body}</p>
          </article>
        ))}
      </div>
      <div className="crm-actions">
        <button
          disabled={messagePage * 50 >= detail.messageTotal}
          onClick={() => setMessagePage(messagePage + 1)}
        >
          Mensagens mais antigas
        </button>
        <button disabled={messagePage === 1} onClick={() => setMessagePage(messagePage - 1)}>
          Mensagens recentes
        </button>
      </div>
      <details>
        <summary>Interesse e aceitação do link</summary>
        <p>
          Confirmações do CEO com evidência numa mensagem recebida. A IA não concede estas
          permissões.
        </p>
        <form onSubmit={(e) => e.preventDefault()}>
          <label>
            Mensagem que comprova a declaração
            <select
              aria-label="Mensagem que comprova a declaração"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            >
              <option value="">Selecionar mensagem recebida</option>
              {detail.messages
                .filter((m) => m.direction === 'inbound')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.body.slice(0, 100)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Evidência da declaração
            <input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </label>
          <label className="agexa-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirmei a declaração do cliente nesta mensagem.
          </label>
          <div className="crm-actions">
            <button
              disabled={!ready || !confirmed || !message || !evidence}
              onClick={() =>
                act(`messaging/conversations/${c.id}/acceptance`, {
                  messageId: message,
                  kind: 'interest',
                  evidence,
                  confirmed,
                })
              }
            >
              Registar interesse
            </button>
            <button
              disabled={!ready || !confirmed || !message || !evidence}
              onClick={() =>
                act(`messaging/conversations/${c.id}/acceptance`, {
                  messageId: message,
                  kind: 'link_acceptance',
                  evidence,
                  confirmed,
                })
              }
            >
              Registar aceitação do link
            </button>
          </div>
        </form>
        <p>
          Interesse: {c.interestedMessageId ? 'confirmado pelo CEO' : 'pendente'} · Link:{' '}
          {c.acceptedMessageId ? 'aceite' : 'não autorizado'}
        </p>
      </details>
      <details>
        <summary>Trabalho dos funcionários</summary>
        <label>
          Funcionário na conversa
          <select
            aria-label="Funcionário na conversa"
            value={employee}
            onChange={(e) => setEmployee(e.target.value as EmployeeId)}
          >
            {EMPLOYEES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="agexa-check">
          <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} />
          Usar inferência Ollama disponível, sem fallback simulado
        </label>
        <div className="crm-actions">
          <button
            disabled={!ready || c.state !== 'open'}
            onClick={() =>
              act(`messaging/conversations/${c.id}/work`, {
                employeeId: employee,
                useAI,
                team: false,
              })
            }
          >
            Preparar material interno
          </button>
          <button
            disabled={!ready || c.state !== 'open'}
            onClick={() =>
              act(`messaging/conversations/${c.id}/work`, {
                employeeId: 'nexus',
                useAI,
                team: true,
              })
            }
          >
            Nexus: coordenar equipa
          </button>
        </div>
        <p>As tarefas e os resultados aparecem no painel Tarefas. Não enviam respostas.</p>
      </details>
      <h4>Rascunho manual / nova versão</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(`messaging/conversations/${c.id}/drafts`, { body, kind }, () => setBody(''));
        }}
      >
        <label>
          Tipo de mensagem
          <select
            aria-label="Tipo de mensagem"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="reply">Resposta</option>
            <option value="invitation">Convite com link oficial</option>
          </select>
        </label>
        <label>
          Texto da resposta
          <textarea
            value={body}
            maxLength={6000}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </label>
        <button disabled={!ready || c.state === 'opted_out'}>Guardar rascunho manual</button>
      </form>
      <h4>Versões, aprovação e envio individual</h4>
      {detail.drafts.map((d) => (
        <Draft
          key={d.id}
          draft={d}
          act={act}
          ready={ready}
          edit={() => {
            setBody(d.body);
            setKind(d.kind);
          }}
        />
      ))}
      <details>
        <summary>Reconciliação de envios</summary>
        <label>
          Evidência independente do envio
          <input value={reconcileEvidence} onChange={(e) => setReconcileEvidence(e.target.value)} />
        </label>
        {detail.deliveries.map((d) => (
          <article key={d.id}>
            <p>
              {d.id} · {d.status} · {d.providerId ?? 'Sem identificador confirmado'}
            </p>
            {['pending', 'reconciliation'].includes(d.status) && (
              <div className="crm-actions">
                <button
                  disabled={!ready || !reconcileEvidence}
                  onClick={() =>
                    act(`messaging/deliveries/${d.id}/reconcile`, {
                      outcome: 'confirmed',
                      evidence: reconcileEvidence,
                    })
                  }
                >
                  Confirmar envio verificado
                </button>
                <button
                  disabled={!ready || !reconcileEvidence}
                  onClick={() =>
                    act(`messaging/deliveries/${d.id}/reconcile`, {
                      outcome: 'not_sent',
                      evidence: reconcileEvidence,
                    })
                  }
                >
                  Confirmar que não foi enviado
                </button>
              </div>
            )}
          </article>
        ))}
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(`messaging/conversations/${c.id}/notes`, { notes });
        }}
      >
        <label>
          Notas internas
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </label>
        <button disabled={!ready}>Guardar notas</button>
      </form>
      <details>
        <summary>Auditoria da conversa</summary>
        {detail.events.map((e) => (
          <p key={e.id}>
            {e.action} · {e.detail}
          </p>
        ))}
      </details>
    </article>
  );
}
function Draft({
  draft: d,
  act,
  ready,
  edit,
}: {
  draft: MessagingDraft;
  act: Act;
  ready: boolean;
  edit: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [copyError, setCopyError] = useState('');
  return (
    <article className="agexa-task">
      <strong>
        Versão {d.version} · {d.employeeId} · {d.mode} · {d.status}
      </strong>
      <p className="messaging-body">{d.body}</p>
      <div className="crm-actions">
        <button onClick={edit}>Editar como nova versão</button>
        <button
          onClick={() => {
            void navigator.clipboard
              .writeText(d.body)
              .catch(() => setCopyError('Selecione o texto para copiar manualmente.'));
          }}
        >
          Copiar texto
        </button>
        {d.status === 'proposed' && (
          <>
            <button
              disabled={!ready}
              onClick={() => act(`messaging/drafts/${d.id}/review`, { decision: 'approved' })}
            >
              Aprovar versão {d.version}
            </button>
            <button
              disabled={!ready}
              onClick={() => act(`messaging/drafts/${d.id}/review`, { decision: 'rejected' })}
            >
              Rejeitar versão {d.version}
            </button>
          </>
        )}
      </div>
      {copyError && <p>{copyError}</p>}
      {d.status === 'approved' && (
        <>
          <label className="agexa-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirmo o envio individual desta versão exata.
          </label>
          <button
            disabled={!ready || !confirmed}
            onClick={() => act(`messaging/drafts/${d.id}/send`, { confirmed: true })}
          >
            Enviar versão {d.version}
          </button>
        </>
      )}
    </article>
  );
}
