import { useState } from 'react';

import { EMPLOYEES } from '../../../core/src/agexa.js';
import type { AgexaKnowledge, IntelligenceConfig } from '../../../core/src/intelligence.js';
import type { SalesOffice } from '../hooks/useSalesOffice.js';

type Action = (route: string, body: unknown, done?: () => void) => void;
export function IntelligencePanel({
  office,
  tab,
  act,
  ready,
}: {
  office: SalesOffice;
  tab: 'intelligence' | 'nexus' | 'knowledge';
  act: Action;
  ready: boolean;
}) {
  const intel = office.snapshot?.intelligence;
  if (!intel)
    return (
      <p>
        Este processo ainda usa o backend da Fase 2. Reinicie o servidor com o código da Fase 3.
      </p>
    );
  if (tab === 'intelligence')
    return (
      <Configuration key={JSON.stringify(intel.config)} office={office} act={act} ready={ready} />
    );
  if (tab === 'knowledge')
    return (
      <Knowledge
        key={JSON.stringify(intel.knowledge)}
        knowledge={intel.knowledge}
        office={office}
        act={act}
        ready={ready}
      />
    );
  return <Nexus office={office} act={act} ready={ready} />;
}
function Configuration({
  office,
  act,
  ready,
}: {
  office: SalesOffice;
  act: Action;
  ready: boolean;
}) {
  const intel = office.snapshot!.intelligence!;
  const [config, setConfig] = useState<IntelligenceConfig>(intel.config);
  return (
    <section>
      <h3>Central de Inteligência</h3>
      <p>
        Chromebook com 2 GB: usar apenas o navegador. O backend e a IA na nuvem correm numa
        máquina/serviço remoto; Ollama local é opcional.
      </p>
      <label>
        Fornecedor de inteligência artificial
        <select
          aria-label="Fornecedor de inteligência artificial"
          value={config.provider ?? 'ollama'}
          onChange={(e) =>
            setConfig({
              ...config,
              provider: e.target.value as 'ollama' | 'gemini',
              baseUrl:
                e.target.value === 'gemini'
                  ? 'https://generativelanguage.googleapis.com'
                  : 'http://127.0.0.1:11434',
              model: '',
              cloudAuthorized: false,
              freeTierConfirmed: false,
              dailyRequestLimit: 20,
            })
          }
        >
          <option value="gemini">Gemini na nuvem · opção gratuita a confirmar</option>
          <option value="ollama">Ollama · opcional noutra máquina</option>
        </select>
      </label>
      {config.provider === 'gemini' && (
        <>
          <p>
            Tentativas de geração hoje (UTC): {intel.cloudUsage?.attempts ?? 0} /{' '}
            {intel.cloudUsage?.limit ?? config.dailyRequestLimit ?? 20}. Contador persistente; não
            substitui as quotas do fornecedor.
          </p>
          <p>
            Chave apenas no backend:{' '}
            {intel.status.credentialConfigured ? 'configurada no processo' : 'não configurada'}.
            Nunca colocar no navegador ou chat. Listar modelos não comprova que são gratuitos.
          </p>
          <p>
            No nível gratuito, rever termos de utilização dos dados e enviar apenas contexto
            autorizado, sem dados sensíveis. A elegibilidade depende da conta/região e pode mudar.
          </p>
          <label className="agexa-check">
            <input
              type="checkbox"
              checked={config.freeTierConfirmed ?? false}
              onChange={(e) => setConfig({ ...config, freeTierConfirmed: e.target.checked })}
            />
            Verifiquei que o modelo e a conta utilizam o nível gratuito, sem faturação paga.
          </label>
          <label className="agexa-check">
            <input
              type="checkbox"
              checked={config.cloudAuthorized ?? false}
              onChange={(e) => setConfig({ ...config, cloudAuthorized: e.target.checked })}
            />
            Autorizo enviar os contextos das tarefas de IA deste escritório ao fornecedor, após
            rever os termos de dados.
          </label>
          <label>
            Limite diário interno de tentativas de geração
            <input
              type="number"
              min={1}
              max={100}
              value={config.dailyRequestLimit ?? 20}
              onChange={(e) => setConfig({ ...config, dailyRequestLimit: Number(e.target.value) })}
            />
          </label>
        </>
      )}
      <p role="status">
        {intel.status.executionMode === 'test'
          ? `TESTE · contrato ${intel.config.provider === 'gemini' ? 'Gemini' : 'Ollama'} simulado`
          : intel.status.connected
            ? `${intel.config.provider === 'gemini' ? 'Gemini' : 'Ollama'} e modelo disponíveis`
            : 'Inferência indisponível'}
      </p>
      <p>
        Serviço: {intel.status.reachable ? 'acessível' : 'não acessível'} · binário Ollama opcional:{' '}
        {intel.status.binaryDetected ? 'detetado' : 'não detetado'}
      </p>
      <p>
        Modelo: {intel.status.model || 'nenhum'} · agentes prontos:{' '}
        {intel.status.connected ? office.snapshot!.employees.filter((e) => e.enabled).length : 0}
      </p>
      {intel.status.error && <p className="agexa-error">{intel.status.error}</p>}
      <p className="agexa-subtle">
        Última verificação:{' '}
        {intel.status.checkedAt
          ? new Date(intel.status.checkedAt).toLocaleString('pt-MZ', { timeZone: 'Africa/Maputo' })
          : 'ainda não realizada'}
      </p>
      <button disabled={!ready} onClick={() => act('intelligence/probe', {})}>
        {config.provider === 'gemini' ? 'Verificar IA na nuvem' : 'Verificar Ollama e modelos'}
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act('intelligence/config', config);
        }}
      >
        <label>
          {config.provider === 'gemini' ? 'Endpoint Gemini fixo' : 'Endereço Ollama'}
          <input
            required
            readOnly={config.provider === 'gemini'}
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
          />
        </label>
        <p className="agexa-subtle">
          {config.provider === 'gemini'
            ? 'HTTPS e proxy/TLS preservados. Sem endpoint personalizado nem chave na interface.'
            : 'Apenas loopback do servidor (127.0.0.1, localhost ou ::1). Não é o localhost do seu telemóvel.'}
        </p>
        <label>
          {config.provider === 'gemini' ? 'Modelo disponível na conta' : 'Modelo instalado'}
          <select
            aria-label="Modelo instalado"
            value={config.model}
            onChange={(e) =>
              setConfig({
                ...config,
                model: e.target.value,
                ...(config.provider === 'gemini' ? { freeTierConfirmed: false } : {}),
              })
            }
          >
            <option value="">Selecionar modelo</option>
            {Array.from(
              new Set([...intel.status.models, ...(config.model ? [config.model] : [])]),
            ).map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        </label>
        {(
          [
            ['timeoutMs', 'Timeout (ms)', 50, 180000],
            ['maxContextChars', 'Limite de contexto (caracteres)', 2000, 24000],
            ['concurrency', 'Inferências simultâneas', 1, 2],
            ['maxTasks', 'Orçamento de tarefas por ordem', 9, 30],
            ['maxInferences', 'Orçamento de inferências por ordem', 9, 30],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              required
              type="number"
              min={min}
              max={max}
              value={config[key]}
              onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <button disabled={!ready}>Guardar configuração de IA</button>
      </form>
      <p className="agexa-subtle">
        Nenhum modelo é descarregado. Configurar um nome não comprova inferência. Sem repetição
        automática, troca de fornecedor ou ativação de plano pago. Os oito funcionários podem
        partilhar o mesmo modelo.
      </p>
      <h3>Histórico de inferências</h3>
      {office
        .snapshot!.tasks.filter((t) => t.kind === 'ai_request')
        .slice(0, 20)
        .map((t) => (
          <article className="agexa-event" key={t.id}>
            <strong>
              {t.employeeId} · {t.status}
            </strong>
            <p>{t.objective}</p>
            <small>
              {t.model ?? 'modelo não executado'} ·{' '}
              {t.durationMs !== null && t.durationMs !== undefined
                ? `${t.durationMs} ms`
                : 'sem duração concluída'}
            </small>
            {t.error && <p className="agexa-error">{t.error}</p>}
          </article>
        ))}
    </section>
  );
}
function Nexus({ office, act, ready }: { office: SalesOffice; act: Action; ready: boolean }) {
  const intel = office.snapshot!.intelligence!;
  const [goal, setGoal] = useState('');
  const [context, setContext] = useState('{}');
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState('');
  return (
    <section>
      <h3>Comando Nexus</h3>
      <p>
        O Nexus propõe um plano por IA. Só após aprovação serão distribuídas sete etapas e uma
        síntese final. Cada etapa é uma inferência separada.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          try {
            const input: unknown = JSON.parse(context);
            if (!input || typeof input !== 'object' || Array.isArray(input))
              throw Error('Contexto deve ser um objeto JSON');
            act('commands', { goal, input: { ...input, authorized } }, () => setGoal(''));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Contexto inválido');
          }
        }}
      >
        <label>
          Ordem comercial ao Nexus
          <textarea
            required
            maxLength={2000}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Quero vender o Agexa a barbearias da Beira. Prepara uma estratégia comercial."
          />
        </label>
        <label>
          Informação empresarial autorizada (JSON)
          <textarea value={context} onChange={(e) => setContext(e.target.value)} />
        </label>
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
          />
          Confirmo a autorização destes dados.
        </label>
        <button disabled={!ready || !authorized || office.snapshot!.suspended}>
          Pedir plano ao Nexus
        </button>
      </form>
      {error && (
        <p role="alert" className="agexa-error">
          {error}
        </p>
      )}
      {!intel.status.connected && (
        <p className="agexa-notice">
          Ollama indisponível: os pedidos ficam bloqueados, sem inventar planos.
        </p>
      )}
      {intel.workflows.map((workflow) => {
        const tasks = office.snapshot!.tasks.filter((t) => t.workflowId === workflow.id);
        const plan = tasks.find((t) => t.id === workflow.planTaskId);
        const steps = plan?.result?.plan as { employeeId: string; objective: string }[] | undefined;
        return (
          <article className="agexa-task" key={workflow.id}>
            <h3>{workflow.goal}</h3>
            <p>
              {workflow.status} · {tasks.filter((t) => t.status === 'completed').length}/
              {tasks.length} etapas concluídas
            </p>
            <small>
              Orçamento: {workflow.taskBudget} tarefas / {workflow.inferenceBudget} inferências
            </small>
            {plan?.result && <p>{String(plan.result.summary)}</p>}
            {steps && (
              <ol>
                {steps.map((step) => (
                  <li key={step.employeeId}>
                    {step.employeeId.toUpperCase()}: {step.objective}
                  </li>
                ))}
              </ol>
            )}
            {workflow.status === 'proposed' && (
              <button
                disabled={!ready || office.snapshot!.suspended}
                onClick={() => act(`workflows/${workflow.id}/approve`, {})}
              >
                Aprovar plano e iniciar equipa
              </button>
            )}
            {!['completed', 'cancelled'].includes(workflow.status) && (
              <button disabled={!ready} onClick={() => act(`workflows/${workflow.id}/cancel`, {})}>
                Cancelar ordem
              </button>
            )}
            {tasks.map((task) => (
              <details key={task.id}>
                <summary>
                  {task.employeeId.toUpperCase()} · {task.stage} · {task.status}
                </summary>
                <p>{task.objective}</p>
                <p>Dependências: {task.dependencyIds?.join(', ') || 'nenhuma'}</p>
                <small>
                  {task.model ?? 'sem modelo executado'} · {task.durationMs ?? '—'} ms
                </small>
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
function Knowledge({
  knowledge,
  office,
  act,
  ready,
}: {
  knowledge: AgexaKnowledge;
  office: SalesOffice;
  act: Action;
  ready: boolean;
}) {
  const [value, setValue] = useState(knowledge);
  const [decision, setDecision] = useState('');
  const [employee, setEmployee] = useState('');
  return (
    <section>
      <h3>Base confirmada do Agexa</h3>
      <p>
        Factos aprovados pelo CEO. Não introduzir credenciais. Sem confirmação, a IA não pode
        anunciar o teste nem inventar o endereço de cadastro.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act('knowledge', {
            ...value,
            ...Object.fromEntries(
              ['confirmedFeatures', 'approvedPrices', 'policies'].map((key) => [
                key,
                value[key as 'confirmedFeatures' | 'approvedPrices' | 'policies']
                  .map((line) => line.trim())
                  .filter(Boolean),
              ]),
            ),
          });
        }}
      >
        <label>
          URL oficial de cadastro
          <input
            type="url"
            value={value.signupUrl ?? ''}
            onChange={(e) => setValue({ ...value, signupUrl: e.target.value || null })}
          />
        </label>
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={value.trialAvailable}
            onChange={(e) => setValue({ ...value, trialAvailable: e.target.checked })}
          />
          Confirmo que o teste de 7 dias está ativo na plataforma.
        </label>
        <p className="agexa-subtle">
          Ativar exige evidência atual em Prontidão operacional. Guardar primeiro URL e
          funcionalidades com a oferta inativa; alterações exigem nova confirmação.
        </p>
        {(
          [
            ['confirmedFeatures', 'Funcionalidades confirmadas'],
            ['approvedPrices', 'Preços aprovados'],
            ['policies', 'Políticas comerciais'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label} (uma por linha)
            <textarea
              value={value[key].join('\n')}
              onChange={(e) =>
                setValue({
                  ...value,
                  [key]: e.target.value.split('\n'),
                })
              }
            />
          </label>
        ))}
        <button disabled={!ready}>Guardar factos confirmados</button>
      </form>
      <h3>Decisão autorizada</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(
            'decisions',
            { content: decision, ...(employee ? { employeeId: employee } : {}) },
            () => setDecision(''),
          );
        }}
      >
        <label>
          Âmbito da decisão
          <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">Toda a equipa</option>
            {EMPLOYEES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Decisão ou orientação operacional
          <textarea
            required
            maxLength={2000}
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          />
        </label>
        <button disabled={!ready}>Registar decisão</button>
      </form>
      <h3>Memória operacional</h3>
      {office.snapshot!.intelligence!.memories.map((memory) => (
        <article className="agexa-event" key={memory.id}>
          <small>
            {memory.kind} · {memory.employeeId ?? 'equipa'}
          </small>
          <p>{memory.content}</p>
        </article>
      ))}
    </section>
  );
}
