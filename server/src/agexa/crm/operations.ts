import type { SalesTask } from '../../../../core/src/agexa.js';
import type { Company, CompanyInput, SalesDraft } from '../../../../core/src/crm.js';
import type { AgexaKnowledge } from '../../../../core/src/intelligence.js';
import { validateOperationalResult } from '../prompts.js';
import { analyzeBusinessWebsite } from './research.js';
import { CrmError, CrmStore } from './store.js';
import { parseCompanyCsv } from './validation.js';

export const draftKind = (employee: string): SalesDraft['kind'] =>
  employee === 'maya'
    ? 'approach'
    : employee === 'luna'
      ? 'simulation'
      : employee === 'victor'
        ? 'objections'
        : 'invitation';
export function crmInput(task: SalesTask): { op: string; companyId?: string; orderId?: string } {
  return (task.input.crm as ReturnType<typeof crmInput>) ?? { op: '' };
}
export function modelCompany(company: Company): Record<string, unknown> {
  return {
    id: company.id,
    name: company.name,
    sector: company.sector,
    city: company.city,
    country: company.country,
    needs: company.needs,
    facts: company.facts,
    adequacyScore: company.score,
    eligibility: company.eligibility,
    sourceId: company.sourceId,
    recordMode: company.recordMode,
    contactOmitted: true,
  };
}
export function preparedDraft(
  task: SalesTask,
  company: Company,
  knowledge: AgexaKnowledge,
): Record<string, unknown> {
  const features = knowledge.confirmedFeatures.slice(0, 3).join('; ');
  let body = '';
  if (task.employeeId === 'maya')
    body = features
      ? `RASCUNHO INTERNO — Olá! Somos do Agexa. Para ${company.name}, podemos explicar estas funcionalidades confirmadas: ${features}. Gostaria de saber mais?`
      : `BRIEF INTERNO — ${company.name}: confirmar funcionalidades do Agexa relevantes para ${company.sector || 'o negócio'} antes de preparar uma abordagem. Nenhuma promessa comercial foi criada.`;
  if (task.employeeId === 'luna')
    body = `SIMULAÇÃO INTERNA — Cliente fictício de ${company.sector || 'serviços'}: "Como podem ajudar?"\nAssistente virtual Agexa: "Que dificuldades encontra na organização do seu negócio?"\n${features ? 'Funcionalidades confirmadas a explicar: ' + features : 'Confirmar funcionalidades com o CEO antes de apresentar benefícios.'}\nPróximo passo: compreender necessidades; sem conversa externa nem demonstração marcada.`;
  if (task.employeeId === 'victor')
    body = `ROTEIRO INTERNO — Objeção: "${String(task.input.objection ?? 'Já utilizo o WhatsApp.').slice(0, 500)}"\nResposta proposta: "Compreendo. Podemos avaliar as suas necessidades antes de recomendar uma mudança."\n${features ? 'Explicar apenas: ' + features : 'Solicitar ao CEO funcionalidades confirmadas; não inventar preços, descontos ou ganhos.'}`;
  if (task.employeeId === 'sophia')
    body =
      knowledge.signupUrl && knowledge.trialAvailable
        ? `PRÉ-VISUALIZAÇÃO INTERNA — Usar apenas após aceitação confirmada.\nPerfeito! Podes criar a tua conta no Agexa e experimentar gratuitamente durante 7 dias.\nAqui está o link: ${knowledge.signupUrl}\nApós o envio confirmado, encaminhar a conversa ao CEO. Esta pré-visualização não foi enviada.`
        : `CHECKLIST INTERNO — Confirmar URL oficial e disponibilidade da oferta com o CEO. Ainda não preparar convite comercial nem afirmar que um link foi enviado.`;
  const blocked =
    (task.employeeId === 'maya' && !features) ||
    (task.employeeId === 'sophia' && (!knowledge.signupUrl || !knowledge.trialAvailable));
  const briefing = blocked ? body : null;
  if (blocked) body = '';
  validateOperationalResult(
    {
      summary: 'Material estruturado por regras, sem inferência',
      draft: body,
      observations: [],
      nextActions: ['Revisão do CEO'],
    },
    task,
    knowledge,
  );
  return {
    summary: `${task.employeeId}: ${blocked ? 'briefing pendente de factos confirmados' : 'material interno preparado'} para ${company.name}`,
    briefing,
    draft: body,
    inference: false,
    mode: 'rules',
    delivery: 'internal_only',
    companyId: company.id,
  };
}
export async function executeImport(
  store: CrmStore,
  task: SalesTask,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const batch = store.batch(String(task.input.batchId));
  const source = store.source(batch.sourceId);
  const payload = batch.payload;
  const threshold = store.settings();
  store.beginResearch(batch.id);
  if (!source.enabled) throw new CrmError('Fonte pausada');
  let records: CompanyInput[] = [];
  let observation: Record<string, unknown> | undefined;
  if (source.kind === 'csv')
    records = parseCompanyCsv(String(payload.csv ?? ''), threshold.maxImportRows);
  else if (source.kind === 'manual') {
    if (!Array.isArray(payload.records)) throw new CrmError('Lista empresarial obrigatória');
    records = payload.records as CompanyInput[];
  } else {
    const websiteCompany = payload.company as CompanyInput;
    if (!websiteCompany?.name) throw new CrmError('Indicar nome empresarial e website autorizados');
    const observed = await analyzeBusinessWebsite(source, websiteCompany, signal);
    records = [observed.company];
    observation = observed.observation;
  }
  signal.throwIfAborted();
  const mode =
    process.env.AGEXA_INFERENCE_TEST_MODE === '1' || payload.simulated === true
      ? 'simulated'
      : source.kind === 'website'
        ? 'observed'
        : source.kind === 'csv'
          ? 'imported'
          : 'provided';
  const result = store.importCompanies(records, source.id, task.id, mode);
  if (observation)
    store.activity(
      'website_observed',
      JSON.stringify(observation),
      result.companyIds[0] ?? null,
      task.id,
      'hunter',
    );
  return {
    ...result,
    sourceId: source.id,
    sourceKind: source.kind,
    recordMode: mode,
    observation,
    inference: false,
    externalMessagesSent: 0,
    summary: `Hunter: ${result.created} empresas registadas; ${result.duplicates} duplicados preservados.`,
  };
}
