import { useState } from 'react';

import type { EmployeeId, TaskKind } from '../../../core/src/agexa.js';
import { EMPLOYEES } from '../../../core/src/agexa.js';
import App from '../App.js';
import type { SalesOffice } from '../hooks/useSalesOffice.js';
import { useSalesOffice } from '../hooks/useSalesOffice.js';
import { AgexaHeader } from './AgexaHeader.js';
import type { CrmTab } from './CrmPanel.js';
import { CrmPanel } from './CrmPanel.js';
import { IntelligencePanel } from './IntelligencePanel.js';
import { MessagingPanel } from './MessagingPanel.js';

const statuses: Record<string, string> = {
  paused: 'Pausado',
  available: 'Disponível',
  working: 'A trabalhar',
  awaiting_approval: 'Aguarda aprovação',
  blocked: 'Bloqueado · IA indisponível',
  error: 'Erro',
  queued: 'Na fila',
  running: 'Em execução',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};
const destination = (source: EmployeeId, preferred: EmployeeId): EmployeeId =>
  preferred === source ? EMPLOYEES.find((employee) => employee.id !== source)!.id : preferred;
const date = (value: string): string =>
  new Date(value).toLocaleString('pt-MZ', { timeZone: 'Africa/Maputo' });

export function AgexaOffice() {
  const office = useSalesOffice();
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  const [selected, setSelected] = useState<EmployeeId>('nexus');
  const [credential, setCredential] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const logout = (): void => {
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.location.replace(url.toString());
  };
  if (office.enabled === null) return <div className="agexa-login">A verificar o ambiente…</div>;
  if (!office.enabled)
    return (
      <div className="agexa-shell">
        <AgexaHeader />
        <main className="agexa-office">
          <App />
        </main>
      </div>
    );
  if (!office.authenticated || office.unauthorized)
    return (
      <div className="agexa-login">
        <h1>AGEXA AI OFFICE</h1>
        <p>Área privada do CEO</p>
        <p>
          Utilize o acesso autenticado gerado pelo servidor ou introduza o token administrativo.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setLoggingIn(true);
            setLoginError('');
            void fetch('/api/agexa/state', { headers: { Authorization: `Bearer ${credential}` } })
              .then((response) => {
                if (!response.ok) throw new Error('Token inválido ou acesso recusado');
                const url = new URL(window.location.href);
                url.searchParams.set('token', credential);
                window.location.replace(url.toString());
              })
              .catch((e: Error) => {
                setLoginError(e.message);
                setLoggingIn(false);
              });
          }}
        >
          <label>
            Token administrativo
            <input
              type="password"
              autoComplete="off"
              required
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
            />
          </label>
          <button disabled={loggingIn}>Entrar</button>
        </form>
        {(loginError || office.error) && <p role="alert">{loginError || office.error}</p>}
      </div>
    );
  return (
    <div className="agexa-shell">
      <header className="agexa-header">
        <div>
          <strong>AGEXA AI OFFICE</strong>
          <span className="agexa-slogan">Organização que trabalha por ti.</span>
        </div>
        <div className="agexa-header-actions">
          <span role="status">
            {office.connection === 'connected'
              ? 'Backend ligado'
              : 'A reconectar · dados podem estar desatualizados'}
          </span>
          <button onClick={() => setOpen(!open)}>{open ? 'Recolher painel' : 'Painel CEO'}</button>
          <button onClick={logout}>Sair</button>
        </div>
      </header>
      <div className="agexa-workspace">
        <main className="agexa-office" aria-label="Escritório virtual Agexa">
          <App
            commercial={office.snapshot ?? undefined}
            commercialLive={office.connection === 'connected'}
            onEmployeeSelect={(id) => {
              setSelected(id);
              setOpen(true);
            }}
          />
          <div className="agexa-inference-note">
            {office.snapshot?.intelligence?.status.executionMode === 'test'
              ? 'TESTE · API Ollama simulada'
              : office.snapshot?.inference.connected
                ? 'Inferência Ollama disponível · rascunhos internos'
                : 'Inferência indisponível · nenhum modelo ativo'}
          </div>
        </main>
        {open && office.snapshot && (
          <SalesPanel
            office={office}
            selected={selected}
            select={setSelected}
            close={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function SalesPanel({
  office,
  selected,
  select,
  close,
}: {
  office: SalesOffice;
  selected: EmployeeId;
  select: (id: EmployeeId) => void;
  close: () => void;
}) {
  const snapshot = office.snapshot!;
  const employee = snapshot.employees.find((e) => e.id === selected)!;
  const [tab, setTab] = useState<
    'team' | 'tasks' | 'events' | 'intelligence' | 'nexus' | 'knowledge' | 'messaging' | CrmTab
  >('team');
  const [kind, setKind] = useState<TaskKind>('prepare_brief');
  const [objective, setObjective] = useState('');
  const [context, setContext] = useState('{}');
  const [authorized, setAuthorized] = useState(false);
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [filter, setFilter] = useState('all');
  const [recipient, setRecipient] = useState<EmployeeId>('atlas');
  const commercialTab = [
    'prospecting',
    'crm',
    'workspace',
    'marketing',
    'reports',
    'commercial',
    'messaging',
  ].includes(tab);
  const ready = office.connection === 'connected' && !busy;
  const act = (route: string, body: unknown, done?: () => void): void => {
    setBusy(true);
    setLocalError('');
    void office
      .command(route, body)
      .then(() => done?.())
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const tasks = snapshot.tasks.filter(
    (t) => t.employeeId === selected && (filter === 'all' || t.status === filter),
  );
  return (
    <aside
      className={`agexa-panel ${commercialTab ? 'agexa-commercial' : ''}`}
      aria-label="Painel privado do CEO"
    >
      <div className="agexa-panel-heading">
        <h2>Controlo CEO</h2>
        <button onClick={close} aria-label="Fechar painel">
          ×
        </button>
      </div>
      <p className="agexa-notice">{snapshot.inference.message}</p>
      <button
        className={snapshot.suspended ? '' : 'agexa-danger'}
        disabled={!ready}
        onClick={() => act('operations', { suspended: !snapshot.suspended })}
      >
        {snapshot.suspended ? 'Retomar operações' : 'Suspender todas as operações'}
      </button>
      <button className="agexa-danger" disabled={!ready} onClick={() => act('messaging/stop', {})}>
        PARAR TODA A AUTOMAÇÃO
      </button>
      <p className="agexa-subtle">Iniciar habilita a fila; não liga um modelo de IA.</p>
      <nav className="agexa-tabs" aria-label="Painel CEO">
        {(
          [
            ['team', 'Funcionários'],
            ['tasks', 'Tarefas'],
            ['events', 'Eventos'],
            ['intelligence', 'Central IA'],
            ['nexus', 'Nexus'],
            ['knowledge', 'Conhecimento'],
            ['prospecting', 'Prospeção'],
            ['crm', 'CRM'],
            ['workspace', 'Sales Workspace'],
            ['marketing', 'Marketing'],
            ['reports', 'Relatórios'],
            ['commercial', 'Comercial'],
            ['messaging', 'WhatsApp Center'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </nav>
      {(office.error || localError) && (
        <p className="agexa-error" role="alert">
          {localError || office.error}
        </p>
      )}
      {!commercialTab && (
        <>
          <div className="agexa-team-grid">
            {snapshot.employees.map((e) => (
              <button
                key={e.id}
                aria-pressed={selected === e.id}
                onClick={() => {
                  select(e.id);
                  setKind('prepare_brief');
                }}
              >
                <strong>{e.name}</strong>
                <small>{e.role}</small>
                <span className={`agexa-status ${e.status}`}>{statuses[e.status]}</span>
              </button>
            ))}
          </div>
          <section className="agexa-employee-details">
            <h3>
              {employee.name} · {employee.role}
            </h3>
            <p>{employee.area} · lugar permanente</p>
            <p>
              {employee.completed} concluídas · {employee.queued} na fila · {employee.errors} erros
            </p>
            <p>
              Tarefa atual:{' '}
              {snapshot.tasks.find((t) => t.id === employee.currentTask)?.objective ??
                'Sem tarefa em execução'}
            </p>
            <button
              disabled={!ready}
              onClick={() => act(`employees/${employee.id}`, { enabled: !employee.enabled })}
            >
              {employee.enabled ? 'Pausar' : 'Iniciar'} {employee.name}
            </button>
          </section>
        </>
      )}
      {tab === 'team' && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const input: unknown = JSON.parse(context);
                if (!input || Array.isArray(input) || typeof input !== 'object')
                  throw Error('Contexto deve ser um objeto JSON');
                act(
                  'tasks',
                  {
                    employeeId: selected,
                    kind,
                    objective,
                    input: { ...input, authorized },
                    requiresApproval: approval,
                  },
                  () => {
                    setObjective('');
                    setTab('tasks');
                  },
                );
              } catch (error) {
                setLocalError(error instanceof Error ? error.message : 'JSON inválido');
              }
            }}
          >
            <h3>Atribuir tarefa a {employee.name}</h3>
            <label>
              Operação
              <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>
                <option value="prepare_brief">Organizar briefing · sem IA</option>
                {selected === 'atlas' && (
                  <option value="qualify_company">Qualificar empresa · regras explícitas</option>
                )}
                {selected === 'orion' && (
                  <option value="sales_report">Relatório de tarefas reais</option>
                )}
                <option value="ai_request">Inferência IA · rascunho interno</option>
              </select>
            </label>
            <label>
              Objetivo
              <textarea
                required
                maxLength={2000}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Objetivo comercial específico"
              />
            </label>
            <label>
              Dados autorizados (JSON)
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                spellCheck={false}
              />
            </label>
            {kind === 'qualify_company' && (
              <p className="agexa-subtle">
                Campos: company, source, usesAppointments, organizationNeed, inMozambique,
                contactConsent. Flags devem ser booleanos.
              </p>
            )}
            <label className="agexa-check">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(e) => setAuthorized(e.target.checked)}
              />
              Confirmo que estes dados são autorizados.
            </label>
            <label className="agexa-check">
              <input
                type="checkbox"
                checked={approval}
                onChange={(e) => setApproval(e.target.checked)}
              />
              Exigir aprovação antes de executar.
            </label>
            <button disabled={!ready || !authorized}>Atribuir tarefa</button>
          </form>
          <details>
            <summary>Objetivo e escritório</summary>
            <p>{snapshot.objective}</p>
            <p>
              Nenhuma mensagem externa é enviada. Oferta e link de inscrição ainda não configurados.
            </p>
            <button
              disabled={!ready}
              onClick={() => {
                if (
                  window.confirm(
                    'Aplicar o layout Agexa? O layout atual será guardado num backup antes da substituição.',
                  )
                )
                  act('layout', { confirm: true });
              }}
            >
              Aplicar layout Agexa com backup
            </button>
          </details>
        </>
      )}
      {tab === 'tasks' && (
        <section>
          <label>
            Estado
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">Todos</option>
              {[
                'queued',
                'running',
                'awaiting_approval',
                'blocked',
                'completed',
                'error',
                'cancelled',
              ].map((s) => (
                <option key={s} value={s}>
                  {statuses[s]}
                </option>
              ))}
            </select>
          </label>
          <p className="agexa-subtle">
            Últimas 200 tarefas da equipa; histórico completo conservado em SQLite.
          </p>
          {tasks.length === 0 && <p>Nenhuma tarefa neste filtro.</p>}
          {tasks.map((task) => (
            <article className="agexa-task" key={task.id}>
              <strong>{task.objective}</strong>
              <p>
                {statuses[task.status]} · {date(task.createdAt)}
              </p>
              <small>
                {task.kind} · prioridade {task.priority}
              </small>
              {task.kind === 'ai_request' && (
                <p>
                  {task.model ?? 'Modelo ainda não executado'} · {task.durationMs ?? '—'} ms ·{' '}
                  {task.stage ?? 'tarefa individual'}
                </p>
              )}
              {task.error && <p className="agexa-error">{task.error}</p>}
              {task.status === 'blocked' && (
                <p>Sem fornecedor de inferência. Nenhuma resposta de IA foi produzida.</p>
              )}
              {task.result && (
                <details>
                  <summary>Resultado estruturado</summary>
                  <pre>{JSON.stringify(task.result, null, 2)}</pre>
                </details>
              )}
              {task.status === 'awaiting_approval' && (
                <button disabled={!ready} onClick={() => act(`tasks/${task.id}/approve`, {})}>
                  Aprovar
                </button>
              )}
              {!['completed', 'error', 'cancelled'].includes(task.status) && (
                <button disabled={!ready} onClick={() => act(`tasks/${task.id}/cancel`, {})}>
                  Cancelar
                </button>
              )}
              {task.status === 'completed' && (
                <div className="agexa-transfer">
                  <label>
                    Transferir resultado
                    <select
                      value={destination(task.employeeId, recipient)}
                      onChange={(e) => setRecipient(e.target.value as EmployeeId)}
                    >
                      {EMPLOYEES.filter((e) => e.id !== task.employeeId).map((e) => (
                        <option value={e.id} key={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={!ready}
                    onClick={() =>
                      act(`tasks/${task.id}/transfer`, {
                        recipient: destination(task.employeeId, recipient),
                      })
                    }
                  >
                    Entregar resultado
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
      {tab === 'events' && (
        <section>
          <h3>Histórico de {employee.name}</h3>
          <p className="agexa-subtle">
            Últimos 100 eventos da equipa; registo completo persistente.
          </p>
          {snapshot.events
            .filter((e) => !e.employeeId || e.employeeId === selected)
            .map((e) => (
              <article className="agexa-event" key={e.id}>
                <small>
                  {date(e.at)} · {e.action}
                </small>
                <p>{e.detail}</p>
              </article>
            ))}
        </section>
      )}
      {(tab === 'intelligence' || tab === 'nexus' || tab === 'knowledge') && (
        <IntelligencePanel office={office} tab={tab} act={act} ready={ready} />
      )}
      {tab === 'messaging' && <MessagingPanel office={office} act={act} ready={ready} />}
      {commercialTab && tab !== 'messaging' && (
        <CrmPanel office={office} tab={tab as CrmTab} act={act} ready={ready} />
      )}
    </aside>
  );
}
