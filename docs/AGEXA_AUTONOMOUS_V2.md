# AGEXA Autónomo V2 — auditoria, adaptação e publicação pendente

Base preservada: `agexa/stage-1-deploy`, 3568c0c. Frontend CEO informado agora:
https://agexa-agentes.base44.app/ . Não confundir com o produto Agexa em
agexa-flix.base44.app nem assumir que ambos possuem o mesmo App ID ou permissões.
Nenhuma produção foi alterada, serviço contratado ou faturação ativada.

## Etapa 1: auditoria e viabilidade gratuita

Node/Fastify, node:sqlite, processos, ficheiros, Chromium e WhatsApp Web não são
transportados para o Worker. O backend original/editor Pixel Agents permanecem.
O Worker reutiliza EMPLOYEES, SalesTask, instruções e validateOperationalResult;
a migração copia o schema/dados originais: tasks, employees, settings, CRM,
conversões, memórias e relatórios, sem criar um CRM vazio substituto.

Consultou-se o repositório oficial cloudflare/cloudflare-docs (branch production):

- [Workers limits](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/platform/limits.mdx): Free 100.000 requests/dia, CPU 10 ms também para Cron; 50 subrequests por invocação.
- [D1 limits](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/d1/platform/limits.mdx): Free 500 MB/base e 5 GB/conta. Limite SQL 100 KB/statement.
- [Workers AI pricing](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers-ai/platform/pricing.mdx): Free 10.000 neurons/dia; excedente exige Workers Paid. Neurons/modelo e consumo das outras aplicações precisam de verificação.

O domínio developers.cloudflare.com foi recusado por CONNECT 403; as fontes acima
foram lidas pelo GitHub oficial. Conta, elegibilidade regional, modelos disponíveis,
quotas D1 diárias efetivas, Cron e Access não foram verificados no painel real.
CPU de 10 ms é um risco material: bundling e testes SQLite não provam viabilidade
no Free. Medir uma invocação real antes de ativar cron. Não declarar orçamento
validado apenas porque o código tem um limite de chamadas.

Não foi selecionado modelo fictício como gratuito. AI_MODEL fica vazio e as flags
FREE_ACCOUNT_CONFIRMED/FREE_MODEL_CONFIRMED falsas. Limite interno 5 tentativas/dia
UTC (máximo 10), max_tokens=256 e contexto até 12 KB. Isso não mede neurons nem
certifica custo; só a conta Free efetiva com o limite do fornecedor garante a
recusa do excedente. Não usar conta Paid, cartão, upgrade ou fallback pago.

## Etapas 2 e 3: execução adaptada

`cloudflare/src/runtime.ts` tem uma etapa por scheduled event, sem navegador.
Leases persistentes serializam crons sobrepostos. Uma inferência expirada/falhada
fica bloqueada para revisão; não é repetida automaticamente quando o resultado ou
custo é incerto. Orçamento reserva tentativas antes de AI.run, incluindo falhas.
Pausa usa epoch: resultado em voo após pausa/stop não é aplicado.

Ordem interna fixa aprovada pelo CEO: Nexus → Hunter → Atlas → Maya → Luna → Victor
→ Sophia → Orion. `enqueue` exige empresa **já existente** no CRM com URL/evidência,
ID de pedido único, objetivo e instante readyAt. Aprovação autoriza só análises e
rascunhos internos; não contacto externo, pagamentos, promoções ou autonomia recursiva.
Resultados anteriores passam ao próximo agente, entram em memories/events e atualizam
apenas nextAction do CRM. Etapas concluídas ficam visíveis a Nexus/CEO; Orion recebe
contagens reais de tarefas/CRM/conversões por origem. Nenhum resultado de modelo
cria empresas, recibos ou clientes pagantes. Textos IA são rascunhos para revisão,
não prova de que uma afirmação comercial ou fonte foi confirmada.

Hunter `research` fica bloqueado: não existe ferramenta de pesquisa autorizada.
`provided` analisa somente registos/URLs fornecidos no CRM; não afirma consultar a
web. Uma cadeia bloqueada aguarda revisão, mas outras ordens elegíveis continuam
nos crons seguintes. Não há scraping/fetch de URLs sugeridas pelo modelo.

Há apenas um motor ativo na promoção: parar o Node antes de promover a cópia D1.
Não sincronizar dois motores que executem os mesmos trabalhos. Tarefas antigas são preservadas para consulta; a sua execução Node não é retomada
automaticamente pelo Worker. Só ordens explicitamente aprovadas para este adaptador
entram em cf_jobs. Ferramentas Node incompatíveis exigem revisão, não reexecução cega.
As tabelas cf_*
são metadata do adaptador (lease/quota/controlo/ligação de tarefas), não outro CRM.

## Etapa 4: painel e segurança

Worker valida criptograficamente JWT Cloudflare Access RS256: assinatura/JWKS de
issuer fixo, audience, expiração e subject CEO em allowlist. Headers de email ou
role enviados pelo utilizador não autenticam. Configuração vazia recusa acesso.
Mutação requer Origin exatamente igual à origem privada, JSON e confirmação humana.
Não há CORS aberto, token permanente no JavaScript, terminal, SQL, QR ou envio.

`build:cloudflare` gera painel privado leve com sprites originais e dados D1,
pausa/retoma/emergência, tarefas/logs/resultados. Não simula atividade. O editor e o
canvas completos do Pixel Agents continuam no projeto Node; **não foram portados
para este painel**, que é uma alternativa de controlo, não o escritório completo.
O painel é só acessível após Access válido, incluindo assets, pelo run_worker_first.

APIs privadas: GET /api/state; POST /api/control {action,confirm:true};
POST /api/employee {id,enabled,confirm:true} (pausa global antes da alteração);
POST /api/order {id:UUID,companyId,objective,mode:'research'|'provided',readyAt:epochMs,
authorized:true,confirm:true}. Sem endpoints públicos de cron/AI ou upload SQL.

O BFF Node/Base44 anterior não é automaticamente um conector para este Worker.
Não foi possível verificar Backend Functions/plano ou integração nativa de agentes
no Base44. Se exigir pagamento, usar este painel Access/Workers Free, **depois de
confirmar elegibilidade Access sem custo na conta**. Não há teste ponta a ponta
com Base44 real nem alteração da página existente. A integração nativa, quando
confirmada, necessita de adaptador autenticado servidor-a-servidor; não colocar
chave de serviço no browser nem confiar só no email de um header.

WhatsApp: o Worker não importa whatsapp-web.js, não usa QR ou automação Web e não
envia mensagens. Arquitetura futura oficial: webhook Meta com assinatura validada,
ID único de entrega, consentimento/janela/preço verificados, tarefa no mesmo CRM,
saída por outbox aprovado e handoff CEO. Credenciais só em bindings secretos.
Essa integração e a integração nativa Base44 **não estão implementadas/operacionais**;
nenhuma campanha ou atendimento WhatsApp foi declarado gratuito.

## Etapa 5: primeiro passo e migração

**Primeiro passo exato:** abrir https://dash.cloudflare.com/ e entrar na conta própria e confirmar Workers
Free, D1, Workers AI e Access sem cartão/faturação. Se qualquer recurso pedir plano
pago ou cartão, parar. Não começar por deployar a configuração com IDs placeholder.

1. No host Node, pausar/parar tarefas e preparar cópia final privada. Não promover
   enquanto a origem continuar a executar. Não transferir locks/PIDs/sessões para
   o Worker; segredos de ficheiros não fazem parte do SQL.
2. Executar Node 22: `node scripts/export-d1.mjs CAMINHO_SALES_SQLITE /CAMINHO_PRIVADO/agexa.sql`.
   Cria backup consistente, SQL e manifest de contagens/hashes, fora do Git e com
   modo 0600. A exportação não escreve na origem nem importa remotamente.
3. Criar uma D1 de **staging**, pelo painel autorizado da conta Free. Guardar o ID
   real em cópia local de cloudflare/wrangler.jsonc. O placeholder não é um ID válido.
   Instalar/rever versão atual do Wrangler fora do lockfile original quando houver
   conta/acesso; não foi instalado nem autenticado nesta sessão.
4. Importar SQL privado nessa staging com `wrangler d1 execute agexa-office --remote --file /CAMINHO_PRIVADO/agexa.sql`.
   Validar suporte de schema, foreign keys, sequências, tamanhos e cada contagem/hash
   do manifest por export de staging. Import parcial/erro impede promoção; não
   apagar a origem ou fazer import por cima de produção. O CLI/D1 pode agrupar
   statements em batches: confirmar atomicidade real antes de promover.
5. Só depois aplicar migrations/0001_runtime.sql na staging. Não a aplicar sozinha
   numa base vazia. employees, CRM, settings e tasks têm de vir da migração original.
6. `npm run build:cloudflare`. Configurar Access para o hostname privado real, team,
   audience e subjects CEO reais. Confirmar o plano gratuito de Access. Se não existir domínio próprio, confirmar no painel suporte Access para um hostname
   gratuito workers.dev antes de o habilitar; sem essa proteção não publicar o painel.
   workers_dev e preview_urls estão desativados para não expor um hostname sem proteção.
7. Rever/configurar modelo realmente disponível no Free, limites de neurons/tokens,
   termos de dados e contexto autorizado. Só então configurar as flags de confirmação.
8. Publicar manualmente a staging pelo Wrangler revisado, sem alterar produção.
   Validar negação anónima, JWT correto/errado, pausa/stop, tempo CPU, D1 rows/quotas
   e uma inferência real com dados fictícios. O adaptador é 1 tarefa por ciclo;
   com quota de 5/dia uma cadeia de 8 não termina num dia. Não aumentar para dar
   aparência de produtividade ou ativar faturação.
9. Depois de teste autorizado e verificação de dados, promover **um** destino.
   Habilitar funcionários selecionados, aprovar ordem interna e retomar pelo painel;
   AUTONOMY_ENABLED=true e triggers.crons=["*/15 * * * *"] ativam o scheduler real.
   A configuração versionada mantém cron vazio e autonomia false deliberadamente.

## Evidência e limites da entrega

Worker empacotado por esbuild para browser/ESM sem runtime Node. Testes usam
node:sqlite como adaptador do contrato D1 e binding AI injetado: validam persistência,
8 etapas, quotas, leases concorrentes, recuperação, pausa, duplicação e JWT assinado.
**Não são testes workerd, D1 remoto, Workers AI real ou Base44.** Nenhuma inferência
Cloudflare real foi feita e nenhuma execução automática em produção foi ativada.
Sem conta/bindings/benchmark de CPU, a viabilidade operacional integral no Free
continua pendente. O sistema original permanece recuperável na branch de referência.

Verificação local: 1.215 testes aprovados (196 interface, 1.012 servidor, 7 contratos), mantendo os 1.204 anteriores; 11 novos. Build Node, build Worker e tipos Worker aprovados. Exportação privada dos dados reais restaurada localmente: contagens/hashes/IDs e foreign keys coincidem. Sem importação remota.
