import { useEffect, useState } from 'react';

import type { OfferVerification, ReadinessReport } from '../../../core/src/readiness.js';
import type { SalesOffice } from '../hooks/useSalesOffice.js';
import { serverToken } from '../transport/serverToken.js';

type Act = (route: string, body: unknown, done?: () => void) => void;
const date = (v: string | null) => (v ? new Date(v).toLocaleString('pt-MZ') : 'Não verificado');
export function ReadinessPanel({
  office,
  act,
  ready,
}: {
  office: SalesOffice;
  act: Act;
  ready: boolean;
}) {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [proof, setProof] = useState<OfferVerification>({
    registrationEvidence: '',
    startsWhen: '',
    expiryBehaviour: '',
    paymentRequired: true,
    includedFeatures: '',
    confirmed: true,
  });
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/agexa/readiness', {
      headers: { Authorization: `Bearer ${serverToken ?? ''}` },
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error('Não foi possível consultar a prontidão privada');
        return r.json() as Promise<ReadinessReport>;
      })
      .then((r) => {
        setReport(r);
        setError('');
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [office.snapshot, revision]);
  const run = (route: string, body: unknown = {}) =>
    act(route, body, () => setRevision((v) => v + 1));
  return (
    <section className="agexa-readiness">
      <h3>AGEXA OPERATIONAL READINESS</h3>
      <p role="status">
        {report?.pilotReady
          ? 'Critérios técnicos desta instância verificados; piloto continua supervisionado.'
          : 'Piloto comercial bloqueado · existem verificações pendentes.'}
      </p>
      <p>
        Testes simulados, declarações humanas e provas reais são apresentados separadamente. Não há
        ativação automática de canais.
      </p>
      <button disabled={!ready} onClick={() => run('readiness/check')}>
        Verificar prontidão
      </button>
      <button disabled={!ready} onClick={() => run('readiness/backup')}>
        Criar backup privado
      </button>
      {error && <p role="alert">{error}</p>}
      <p className="agexa-subtle">{report?.scope}</p>
      {report?.checks.map((c) => (
        <article className="agexa-event" key={c.id} data-readiness={c.id}>
          <strong>
            {c.name} · {c.state}
          </strong>
          <small>
            Origem: {c.mode} · {date(c.checkedAt)}
          </small>
          <p>{c.evidence}</p>
          {c.blocker && <p className="agexa-error">Bloqueio: {c.blocker}</p>}
          <p>Próxima ação: {c.nextAction}</p>
        </article>
      ))}
      <h4>Validação individual de inferência</h4>
      <p>
        Cada botão cria uma tarefa interna real apenas se existir modelo acessível. A animação
        acompanha a execução da fila. Consultar resultados completos em Tarefas.
      </p>
      {report?.employees.map((e) => (
        <article key={e.employeeId} className="agexa-event">
          <strong>
            {e.employeeId.toUpperCase()} · {e.status}
          </strong>
          <p>
            {e.mode} · {e.model ?? 'Sem modelo'} · {e.durationMs ?? '—'} ms · {date(e.at)}
          </p>
          <small>Tarefa: {e.taskId ?? 'Não executada'}</small>
          {e.error && <p>{e.error}</p>}
          <button
            disabled={!ready || office.snapshot?.suspended}
            onClick={() => run(`readiness/employees/${e.employeeId}/inference`)}
          >
            Verificar {e.employeeId.toUpperCase()}
          </button>
        </article>
      ))}
      <h4>Confirmação da oferta pelo CEO</h4>
      <p>
        Não executar cadastro nesta página. Primeiro verificar a aplicação autorizada. Guardar URL e
        funcionalidades em Conhecimento com a oferta inativa; registar abaixo a prova e depois
        ativar a oferta. Alterações invalidam a prova anterior.
      </p>
      <p>
        {report?.offer.valid
          ? 'Evidência corresponde à configuração atual'
          : 'Sem confirmação atual'}{' '}
        · {date(report?.offer.verifiedAt ?? null)} · {report?.offer.mode}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (confirmed) run('readiness/offer', proof);
        }}
      >
        {(
          [
            ['registrationEvidence', 'Evidência do cadastro e dos sete dias'],
            ['startsWhen', 'Quando começa a contagem'],
            ['expiryBehaviour', 'O que acontece ao fim do prazo'],
            ['includedFeatures', 'Funcionalidades disponíveis no teste'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              required
              minLength={10}
              maxLength={1000}
              value={proof[key]}
              onChange={(e) => setProof({ ...proof, [key]: e.target.value })}
            />
          </label>
        ))}
        <label className="agexa-check">
          <input
            type="checkbox"
            checked={proof.paymentRequired}
            onChange={(e) => setProof({ ...proof, paymentRequired: e.target.checked })}
          />
          É necessário pagar para continuar após o teste.
        </label>
        <label className="agexa-check">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Verifiquei estes factos por acesso autorizado; não são suposições do modelo.
        </label>
        <button disabled={!ready || !confirmed}>Registar evidência da oferta</button>
      </form>
      <h4>Histórico das verificações</h4>
      {report?.history.map((h) => (
        <p key={h.at}>
          {date(h.at)} · {h.validated} validados · {h.pending} pendentes · {h.errors} erros
        </p>
      ))}
    </section>
  );
}
