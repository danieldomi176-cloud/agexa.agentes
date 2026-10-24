# AGEXA AI OFFICE — desenvolvimento

## Fase 1

Código base importado de `pixel-agents-hq/pixel-agents`, revisão
`b1bafd02896d90d83457266575a1e8e5011ce997`. O remoto do projeto Agexa
foi preservado. Não foram importados o histórico Git nem credenciais.
A licença MIT e os créditos originais continuam no repositório.

Implementado: identidade Agexa no cabeçalho e manifesto, cores roxa/violeta,
indicação explícita de simulação no Vite, diretório de persistência configurável,
comandos de arranque e smoke test HTTP/WebSocket. Não há mensagens externas,
modelos pagos, contas WhatsApp ligadas ou dados comerciais inventados.

## Instalação e execução

Requisitos: Linux/macOS/Windows, Node 22 (ver `.nvmrc`), npm e cerca de 1 GB
livre para dependências e builds. Não é necessário Claude, Ollama ou WhatsApp
para abrir e editar o escritório; Claude é necessário para o fluxo original de
agentes de programação, que não substitui o futuro motor comercial.

Na nuvem preparada, ativar Node 22:

```bash
export PATH=/workspace/.tooling/node22/node_modules/node/bin:$PATH
cd /workspace/agexa.agentes
npm ci
npm run build
npm test
npm run asyncapi:validate
```

Em outra máquina, instalar/ativar a versão de `.nvmrc` antes desses comandos.
Não executar `npm install` para atualizar dependências durante o setup.

```bash
export AGEXA_DATA_DIR=/workspace/.agexa-data
npm run start:agexa
```

O servidor escuta apenas na interface local, porta 3100, com terminais
embutidos desativados. A interface original oferece edição apenas na sessão
privilegiada autenticada pelo token gerado. O URL autenticado aparece no terminal;
tratá-lo como segredo. Não publicar logs de arranque com esse URL.
Na nuvem de onboarding, validar internamente, sem criar links de preview.

Em outro terminal, executar `npm run test:smoke`. Para parar, usar Ctrl+C.
Processos precisam de novo arranque após restaurar/publicar o ambiente.
Cada tarefa cloud já está isolada: usar o checkout existente, sem criar worktrees.

`AGEXA_DATA_DIR` deve ser absoluto e ficar fora do checkout. Guarda configurações,
layout, estado por adaptador, token e registos de descoberta do servidor.
Sem a variável, mantém-se o comportamento original em `~/.pixel-agents`.
A variável não altera `HOME`, nem o local das configurações do Claude.
Se forem usados hooks do Claude, todos os processos envolvidos precisam de
herdar o mesmo `AGEXA_DATA_DIR`. Hooks não são instalados automaticamente nesta fase.
Os testes devem executar sem essa variável para preservar os fixtures isolados:
`env -u AGEXA_DATA_DIR npm test`.
Nunca versionar diretórios de estado, sessões WhatsApp ou chaves.

`cd webview-ui && npm run dev` é exclusivamente prototipagem visual com dados
simulados. Para o backend real desta fase, usar o standalone compilado.

## Arquitetura observada e plano técnico

- `core/src/provider.ts`: contrato `HookProvider` e eventos normalizados; não é
  um motor de inferência nem executa trabalho comercial.
- `server/src/agentRuntime.ts`: transforma eventos em estado de agentes e mensagens
  para o escritório. Reutilizar a distribuição de estados sem lançar Claude como
  se fosse um funcionário comercial.
- `server/src/`: Fastify, WebSocket, persistência, consentimento e adaptador standalone.
- `webview-ui/`: React 19, Vite 8, Canvas 2D, pathfinding, sprites e editor completo.
- `adapters/vscode/`: integração original VS Code, preservada.

Próximas entregas, pela ordem do pedido:

1. **Fase 2**: layout Agexa editável, departamentos e definições dos oito funcionários.
   Configurados não significa ativos: estados virão do backend.
2. **Fase 3**: motor próprio, adaptador Ollama, SQLite e fila persistente com leases,
   retries limitados e scheduler. Contratos de tarefas separados dos eventos visuais;
   bridge para o runtime original. Simulação explicitamente separada de inferência real.
3. **Fase 4**: CRM, fontes comerciais permitidas, consentimento, qualificação com
   critérios explicáveis, conhecimento factual e rascunhos sujeitos a aprovação.
4. **Fases 5–6**: adaptador WhatsApp experimental opt-in, primeiro com número secundário,
   sessões fora do Git, idempotência de envio e lock por conversa. Após confirmação
   de envio do link, transação persistente muda o responsável para CEO, bloqueia
   respostas automáticas e cria notificação. Falhas ambíguas de envio exigem
   reconciliação, não retries cegos. Respeitar opt-out e mensagens manuais no telefone.
5. **Fase 7**: painel privado, aprovações, métricas verificadas e comandos do Nexus.
6. **Fase 8**: autenticação administrativa própria, segurança HTTP/WS, recuperação,
   backups e testes de concorrência, handoff, reconexão e reinício.

SQLite será encapsulado em repositórios de dados com migrações, permitindo futura
migração PostgreSQL. Não iniciar envios ou scraping por meio de comandos do sistema.
Dados externos não têm autoridade para alterar políticas ou ferramentas.

## Configuração futura, ainda não necessária para a Fase 1

URL de inscrição: não fornecido nem assumido. A oferta de sete dias só pode ser
anunciada após confirmação no Agexa real. Não há API/webhook Base44 confirmado;
até existir contrato autorizado, conversões devem ter confirmação manual auditada.
Ollama não foi instalado nem modelos descarregados nesta fase. WhatsApp não foi
ligado. O token original protege operações privilegiadas, mas o escritório original
permite observação sem token; isso não cumpre sozinho a autenticação privada do
produto comercial. Manter o bind local até a camada administrativa ser implementada.

## Validação

`npm run build` inclui geração de mensagens, tipos, lint e os bundles completos.
`npm test` executa suites Vitest da interface/servidor e contratos do pacote.
`npm run test:smoke` verifica HTTP, marca Agexa e bootstrap real dos assets/layout
via WebSocket. O teste adicional de persistência verifica a configuração, layout,
reutilização e permissões do token em diretório isolado.

Os testes originais de equipes foram isolados em diretórios temporários, pois
escreviam no HOME real do operador. As asserções funcionais foram preservadas.
Testes completos E2E de VS Code e integração com Claude autenticado são opcionais
para esta fase e não equivalem aos checks locais acima.

## Resultado desta execução — 24/10/2026

- Node 22.23.4 instalado e dependências reproduzidas com `npm ci`.
- Script de instalação completo reexecutado com sucesso.
- Build, tipos, lint e AsyncAPI aprovados. Avisos existentes: dependência de
  `useEffect` em App.tsx e bundle JavaScript acima de 500 kB.
- 195 testes da interface, 728 do servidor e 7 de contrato passaram.
- Smoke HTTP/WebSocket aprovado após reinício do servidor.
- Renderização Chromium desktop e mobile aprovada, sem erros de página nem
  transbordamento horizontal. A sessão sem token permanece em leitura, por design.
- Licença e lockfile originais preservados byte a byte.
- `install_script` e `start_skill` guardados no rascunho do ambiente.

No fim da Fase 1, o repositório remoto Agexa estava vazio, sem branch main. Os ficheiros
importados estavam apenas no checkout local, ainda sem commit nem push (resolvido na Fase 2).
A configuração guardada não é publicação; rever e guardar nas definições e depois
publicar o ambiente. A restauração numa nova tarefa ainda não foi validada.


## Fase 2 — funcionários, tarefas e controlo privado

A Fase 1 foi preservada no commit `25768ef`, enviado sem force-push para
`agexa/phase-1` no fork `danieldomi176-cloud/agexa.agentes`. Não foi substituído
nenhum trabalho remoto. A instalação e o build guardados foram reexecutados;
a máquina continuou a ser a mesma. Não foi efetuada uma reconstrução completa
pelo produto nem validada a restauração numa tarefa nova.

### O que funciona

- Oito identidades permanentes: Nexus, Hunter, Atlas, Maya, Luna, Victor, Sophia
  e Orion. Seis sprites originais com cores distintas para os oito funcionários;
  nenhum novo sprite licenciado de terceiros foi necessário.
- Layout Agexa de 32×23 tiles com cinco áreas, oito secretárias/computadores e oito
  cadeiras identificadas. É editável com o editor original. Mover uma cadeira
  conserva o seu identificador e lugar atribuído após reinício.
- Novo layout usado em instalações sem layout guardado. Layouts já guardados são
  preservados. O painel oferece **Aplicar layout Agexa com backup**, com confirmação
  explícita e cópia do layout anterior fora do Git.
- Painel privado com autenticação pelo token administrativo persistente original.
  Sem token, a aplicação comercial apresenta apenas o formulário de acesso.
  API comercial e WebSocket comercial exigem token, Host permitido e origem correta;
  não publicam tarefas nem dados comerciais através do canal público do Pixel Agents.
- Fila SQLite durável, estados e timestamps, prioridade, tarefas por funcionário,
  eventos auditáveis, resultados estruturados, erros, aprovação e cancelamento.
- Iniciar e pausar cada fila, suspender globalmente e retomar operações.
  Dois trabalhos no máximo em paralelo e apenas um por funcionário.
- Transferência explícita de resultado concluído para outro funcionário; repetir
  a mesma transferência para o mesmo destinatário devolve a tarefa já criada.
- Estados visuais derivados exclusivamente do backend. Funcionários configurados
  ou pausados permanecem quietos no lugar; só tarefas em execução ativam trabalho.
  Perda de ligação suspende a animação de trabalho e identifica o estado desatualizado.
- Persistência após reinício e reconexão dos eventos no navegador.

Os botões do painel alteram o backend. **Iniciar** habilita a fila; não instala
um modelo nem representa inferência real. O tutorial inicial de programação do
Claude fica oculto no escritório comercial; o fluxo original continua disponível
quando o CLI é iniciado sem `--agexa`.

### Operações disponíveis sem IA

1. `prepare_brief`: organiza o objetivo, o contexto autorizado e o checklist
   comercial num resultado estruturado, com `inference: false`. Não produz pesquisa
   ou mensagens supostamente escritas por IA.
2. `qualify_company`, apenas Atlas: classifica dados fornecidos pelo CEO. Campos
   obrigatórios: `company` e `source`; critérios booleanos `usesAppointments` (40),
   `organizationNeed` (30), `inMozambique` (20) e `contactConsent` (10).
   Critérios ausentes não ganham pontos. A pontuação não autoriza contacto.
3. `sales_report`, apenas Orion: conta tarefas reais. Registos, clientes pagantes
   e receita continuam `null` (não integrados), sem inventar conversões.
4. `ai_request`: fica `blocked` enquanto não existir adaptador de inferência ligado.
   A interface `InferenceAdapter` recebe apenas a tarefa e contexto comercial
   controlado, incluindo um `AbortSignal`, para integração Ollama na Fase 3.

Todas as tarefas exigem declaração `authorized: true` para os dados fornecidos.
Não existem ferramentas de shell, scraping ou envio externo no motor desta fase.
Conteúdo do contexto é dado, não instrução administrativa. Nenhuma tarefa pode
alterar políticas ou permissões através desse conteúdo.

Exemplo de contexto para Atlas:

```json
{
  "company": "Empresa com informação fornecida pelo CEO",
  "source": "Registo comercial autorizado",
  "usesAppointments": true,
  "organizationNeed": true,
  "inMozambique": true,
  "contactConsent": false
}
```

No formulário, confirmar a autorização dos dados. Criar a tarefa, iniciar Atlas e
consultar o resultado em **Tarefas**. Sem consentimento de contacto, o resultado
continua a indicar `contactPermitted: false`.

### Arranque e acesso

```bash
export PATH=/workspace/.tooling/node22/node_modules/node/bin:$PATH
export AGEXA_DATA_DIR=/workspace/.agexa-data
cd /workspace/agexa.agentes
umask 077
npm run start:agexa
```

O comando inclui `--agexa --host 127.0.0.1 --port 3100 --no-terminal`.
Abrir o endereço autenticado que o servidor imprime no terminal privado, ou
introduzir o mesmo token no formulário de acesso. Não publicar esse endereço,
logs de arranque ou capturas que mostrem o token. O painel pode ser recolhido
para ver o escritório inteiro; no telemóvel começa recolhido.

A autenticação usa um único token de capacidade administrativa; não é um sistema
multiutilizador. Para revogar URLs antigas, parar o servidor e executar o CLI
com `--rotate-token` além dos argumentos habituais. Manter o bind local; acesso
remoto requer uma camada HTTPS privada e configuração explícita de Hosts.
As rotas originais do Pixel Agents conservam o seu comportamento de observação;
os dados comerciais só circulam nas rotas privadas `/api/agexa/*`.

### Dados, recuperação e limites

`sales.sqlite`, respetivos WAL/SHM e `sales.lock` ficam em `AGEXA_DATA_DIR`, fora
do repositório. O ficheiro principal é privado (0600). SQLite é disponibilizado
pelo próprio Node 22.23.4 e emite aviso de funcionalidade experimental; não foi
adicionada dependência paga nem alterado o lockfile de pacotes.
O lock impede dois workers sobre o mesmo diretório. Não apagar um lock de processo
ativo. Após crash, um lock com PID inexistente pode ser recuperado automaticamente.
Tarefas que estavam em execução passam para erro auditado, sem repetição cega.
Paragem controlada ou suspensão cancela execuções em curso, descarta resultados
tardios e conserva as tarefas que ainda estavam na fila.

O painel recebe as últimas 200 tarefas e 100 eventos da equipa; os dados completos
continuam no SQLite. Os indicadores individuais consultam todo o histórico.
Para backup, parar o servidor e copiar o diretório de dados completo para um local
privado. Nunca versionar o banco, sessões ou tokens. Migrações PostgreSQL, ferramentas
comerciais externas e uma política completa de retenção ficam para fases futuras.

### Verificação reproduzível

```bash
npm run build
npm run lint
env -u AGEXA_DATA_DIR npm test
npm run asyncapi:validate
npm run test:smoke
AGEXA_CHROMIUM_PATH=/usr/bin/chromium npm run test:agexa:e2e
```

O último comando cria servidor e banco temporários, autentica o CEO, verifica as
oito cadeiras reais e cinco áreas, atribui e executa uma tarefa, suspende operações,
reinicia o processo, verifica persistência e reconexão, abre o editor original e
valida desktop/mobile. Dados de teste não entram no escritório real. Noutras
máquinas, usar um Chromium do Playwright instalado ou informar o executável em
`AGEXA_CHROMIUM_PATH`. As capturas opcionais usam `AGEXA_SCREENSHOT_DIR` fora do Git.

Os testes do motor cobrem consentimento dos dados, permissões por operação,
aprovação, inferência desligada, qualificação, erros, transferência idempotente,
paragem global, limites de concorrência, locks, recuperação e resultados tardios.
Os testes HTTP/WebSocket cobrem autenticação, isolamento, validação de entradas,
eventos privados e backup de layout.

### Dependências da Fase 3 e fases seguintes

Ollama ainda não está ligado: não há inteligência comercial autónoma a funcionar.
Hunter não pesquisa a Internet, Luna não conversa com clientes, Sophia não envia
links e nenhum funcionário faz contactos externos nesta fase. As suas identidades,
filas, resultados e estados reais estão prontos para receber ferramentas e modelos.
A oferta de sete dias, o URL de inscrição, o WhatsApp, o CRM e conversões Base44
continuam sem integração; não são anunciados como funcionalidades operacionais.

### Resultado da validação da Fase 2

Build, tipos, lint e AsyncAPI aprovados. **196 testes da interface, 744 do servidor
e 7 de contrato do pacote passaram (947 no total)**, sem testes ignorados nesta
execução. O cenário Chromium da Fase 2 passou, incluindo autenticação, oito lugares
em cinco áreas, execução real de tarefa estruturada, suspensão, reinício, persistência,
reconexão e editor original. Smoke do servidor real da porta 3100 aprovado após
substituição do processo anterior da Fase 1. O banco do ambiente começou sem tarefas
de demonstração; os testes usaram diretórios temporários separados.

Mantêm-se os avisos anteriores de dependência de useEffect e tamanho do bundle,
e o aviso experimental do SQLite do Node. A suite completa E2E de VS Code e sessões
Claude reais não foi executada; não é necessária para o fluxo comercial desta fase.
Licença MIT e package-lock.json continuam iguais aos da Fase 1.

As instruções de arranque precisam de ser publicadas juntamente com o snapshot
do ambiente. A confirmação de guardar configuração não é uma publicação, nem uma
validação de restauração numa máquina nova. Não foram solicitadas novas credenciais.

### Ficheiros da Fase 2

- `README.md`
- `core/src/agexa.ts`
- `docs/AGEXA.md`
- `package.json`
- `scripts/agexa-e2e.mjs`
- `scripts/agexa-smoke.mjs`
- `server/__tests__/salesEngine.test.ts`
- `server/__tests__/salesRoutes.test.ts`
- `server/src/agexa/engine.ts`
- `server/src/agexa/routes.ts`
- `server/src/cli.ts`
- `server/src/httpServer.ts`
- `server/src/server.ts`
- `server/src/serverConfig.ts`
- `webview-ui/public/assets/agexa-layout.json`
- `webview-ui/src/App.tsx`
- `webview-ui/src/agexa/pixelBridge.ts`
- `webview-ui/src/components/AgexaOffice.tsx`
- `webview-ui/src/hooks/useSalesOffice.ts`
- `webview-ui/src/index.css`
- `webview-ui/src/main.tsx`
- `webview-ui/src/office/components/ToolOverlay.tsx`
- `webview-ui/src/office/engine/characters.ts`
- `webview-ui/src/office/engine/officeState.ts`
- `webview-ui/src/office/types.ts`
- `webview-ui/test/salesBridge.test.ts`


## Fase 3 — Ollama, memória operacional e colaboração

### Preservação e estado desta entrega

A branch `agexa/phase-3` foi criada a partir de
`21ba48662c20f1b8188102a8033e275a3c4c1e3d`, confirmado também no remoto
`agexa/phase-2`. As branches e commits anteriores continuam preservados.
Não foram adicionadas dependências de APIs pagas, nem alterados a licença ou o lockfile.
A migração SQLite v1 → v2 é aditiva: acrescenta colunas e tabelas para inferência,
memória e ordens Nexus, mantendo as tarefas e definições existentes.

**Neste ambiente não foi encontrado binário Ollama, serviço local na porta 11434
ou modelo instalado acessível. Nenhum modelo foi descarregado.** A ligação real
continua dependente de um serviço/modelo preparado pelo operador. Os oito funcionários
foram exercitados contra um servidor simulado do contrato Ollama nos testes; nenhum
foi declarado como tendo usado um LLM real nesta validação.

Os testes usam diretórios temporários. Antes do arranque atualizado no diretório
real, foi criado backup SQLite consistente e privado em `/workspace/.agexa-backups/`,
fora do Git, com o escritório sem tarefas em execução. Os registos pré-existentes
são comparados por hash, sem imprimir os seus conteúdos.

### Módulos

- `core/src/intelligence.ts`: configuração, conhecimento, resultados operacionais,
  memória e contratos de workflow.
- `server/src/agexa/ollama.ts`: adaptador HTTP Ollama `/api/tags` e `/api/chat`,
  deteção do binário, disponibilidade observada, modelo, limites, timeout e cancelamento.
- `server/src/agexa/prompts.ts`: instruções individuais e validação dos resultados.
- `server/src/agexa/memory.ts`: migração aditiva, factos confirmados, decisões,
  resumos operacionais e recuperação de contexto relevante.
- `server/src/agexa/engine.ts`: fila anterior estendida com dependências, orçamentos,
  aprovação de planos, registos de modelo/duração e cancelamento da ordem inteira.
- `server/src/agexa/intelligenceRoutes.ts`: rotas administrativas no mesmo âmbito
  protegido por token, Host e Origin da Fase 2.
- `webview-ui/src/components/IntelligencePanel.tsx`: Central IA, Comando Nexus e
  conhecimento confirmado pelo CEO, integrados no painel existente.

### Preparar Ollama e escolher o modelo

1. Na máquina que executa o backend, disponibilizar Ollama e um modelo local já
   instalado. Se o binário estiver instalado, `ollama serve` inicia o serviço e
   `ollama list` mostra os modelos. Esta aplicação não instala o serviço nem executa
   `ollama pull`. Qualquer download exige autorização separada do operador.
2. Arrancar o escritório com os mesmos comandos das fases anteriores:

```bash
export PATH=/workspace/.tooling/node22/node_modules/node/bin:$PATH
export AGEXA_DATA_DIR=/workspace/.agexa-data
cd /workspace/agexa.agentes
umask 077
npm run start:agexa
```

3. Entrar com o acesso administrativo privado. Em **Central IA**, indicar o endereço
   do serviço (por omissão `http://127.0.0.1:11434`) e guardar. O backend consulta os
   modelos instalados; escolher um na lista e guardar novamente.
4. Confirmar serviço acessível, modelo presente e inferência disponível. Um campo
   preenchido não estabelece prontidão. A verificação é renovada periodicamente;
   a geração também verifica o serviço e o modelo antes da chamada.

O endereço é relativo à máquina do backend, não ao navegador/telemóvel do CEO.
Por segurança, a configuração aceita apenas loopback (`localhost`, `127.0.0.1`,
`::1`), sem credenciais, caminhos adicionais, query ou redirecionamentos HTTP.
Serviços noutra máquina precisam primeiro de um encaminhamento local autorizado;
não é feito scan de rede nem acesso arbitrário a hosts remotos.

Uma configuração corresponde a um modelo partilhado pelos oito funcionários,
com instruções diferentes. O estado deteta binário e serviço separadamente:
pode existir um serviço local acessível mesmo sem binário no PATH do backend.
A presença em `/api/tags` prova disponibilidade observada do serviço/modelo;
a execução ainda pode falhar por recursos, contrato ou saída inválida, e a tarefa
regista o erro em vez de produzir uma resposta falsa.

### Exemplo de colaboração

Em **Conhecimento**, confirmar apenas funcionalidades, preços, políticas e oferta
que existam no Agexa real. Não há URL de cadastro inventado. A duração é sete dias;
a oferta só pode ser ativada com URL HTTPS confirmado. Sem confirmação, o rascunho
não pode anunciar teste gratuito nem incluir um URL não aprovado.

Em **Nexus**, escrever:

> Quero vender o Agexa a barbearias da Beira. Prepara uma estratégia comercial.

Fornecer os dados empresariais autorizados no campo JSON e confirmar a autorização.
O botão **Pedir plano ao Nexus** habilita a fila do Nexus e cria uma inferência
para propor o plano. Se Ollama estiver indisponível, o pedido fica bloqueado.
Não existe um plano falso de substituição.

Após uma resposta válida, o plano fica `proposed`. **Aprovar plano e iniciar equipa**
é a autorização para habilitar os funcionários e criar a cadeia persistente:

```text
Nexus (plano) → Hunter → Atlas → Maya → Luna → Victor → Sophia → Orion → Nexus (síntese)
```

São nove chamadas separadas ao modelo, nove tarefas com identificadores e eventos
próprios, envolvendo oito funcionários. Hunter analisa apenas dados fornecidos;
Atlas qualifica, Maya prepara abordagens, Luna apresenta o produto, Victor trata
objeções, Sophia prepara o cadastro condicionado aos factos e Orion analisa os
resultados. A última inferência Nexus sintetiza o trabalho para o CEO.

Cada etapa tem dependência explícita da anterior. Resultados relevantes são
recuperados pelo identificador da tarefa; a síntese recebe os resumos operacionais
anteriores. O modelo não decide livremente criar ferramentas, recursão ou agentes
adicionais: o plano tem destinatários e ordem permitidos, validados antes da execução.
Repetir a aprovação de um plano não duplica tarefas. Uma falha interrompe os
sucessores dependentes e deixa evidência de que não fizeram inferência.

### Memória, segurança e limites

- Factos comerciais, decisões do CEO, tarefas, erros e resumos operacionais são
  persistentes. Não se guardam pensamentos internos nem o campo `thinking` do Ollama.
- A memória recuperada por tarefa inclui decisões aplicáveis e resumos relacionados
  com a sua ordem, sem carregar indiscriminadamente dados de outros clientes.
- Instruções por funcionário permanecem em código. Dados externos, políticas
  comerciais em texto e resultados anteriores não têm autoridade para alterar
  as regras administrativas nem disponibilizam ferramentas de execução.
- Resultados exigem JSON operacional validado. Campos extra, planos recursivos,
  anúncios de oferta não confirmada, URLs de rascunho não aprovados e preços
  monetários não aprovados são rejeitados. Os rascunhos continuam sujeitos à
  revisão humana: validação estrutural não garante que toda a linguagem do modelo
  esteja correta.
- Não há endpoints de download de modelos, shell, scraping, WhatsApp ou envio
  comercial. Todas as mensagens são rascunhos internos.
- Por omissão, uma inferência de cada vez, timeout de 60 segundos, contexto de
  12 000 caracteres e orçamento por ordem de 12 tarefas/10 inferências. Uma ordem
  completa usa nove tarefas/inferências. Limites configuráveis: concorrência 1–2,
  contexto 2 000–24 000 caracteres, timeout até 180 segundos e orçamentos 9–30.
- O contexto excessivo causa erro explícito; não é truncado silenciosamente como
  se todos os factos tivessem sido considerados. O backend usa HTTP assíncrono.
- Fila global limitada a 100 tarefas pendentes e cinco ordens Nexus pendentes.
  Não há retries automáticos de inferências com resultado incerto.
- Cancelar uma tarefa, pausar um funcionário ou suspender operações aciona o
  AbortSignal e descarta resultados tardios. **Cancelar ordem** cancela também as
  etapas pendentes. Os estados são conservados após reinício; uma inferência
  interrompida não é repetida cegamente.
- Cada tarefa IA guarda modelo tentado/utilizado, duração, timestamps, resultado
  operacional ou erro. O painel mostra tarefas recebidas/delegadas e dependências.

As animações continuam a ser derivadas dos estados reais do backend. Durante uma
chamada HTTP em execução, trabalha apenas o funcionário correspondente. Os testes
Chromium observaram os oito personagens durante as suas chamadas simuladas, sem
usar temporizadores para fabricar atividade no escritório.

### Testes e distinção entre simulação e inferência real

```bash
npm run build
npm run lint
env -u AGEXA_DATA_DIR npm test
npm run asyncapi:validate
npm run test:smoke
AGEXA_CHROMIUM_PATH=/usr/bin/chromium npm run test:agexa:e2e
AGEXA_CHROMIUM_PATH=/usr/bin/chromium npm run test:agexa:intelligence:e2e
```

O último comando usa um emulador HTTP em
`server/__tests__/helpers/mockOllama.ts`, isolado dos dados do CEO. O processo de teste
é iniciado com `AGEXA_INFERENCE_TEST_MODE=1`; o painel e cada resultado identificam
`executionMode: test`. Esse sinalizador não deve ser usado no escritório real.
Não existe fallback automático para inferência simulada em produção.

As suites novas verificam ligação, indisponibilidade, modelo ausente, validação,
respostas inválidas, limite de resposta, timeout, AbortSignal, cancelamento, memória,
aprovação Nexus, dependências Atlas → Maya → Luna → Victor → Sophia → Orion,
limites de concorrência, reinício, falha de agente, autenticação e migração dos dados
da Fase 2. Os testes Chromium também verificam a seleção de modelo, os nove pedidos,
os oito personagens, persistência/reconexão e desktop/mobile.

### Resultado da validação desta entrega

- Build, tipos e lint aprovados; AsyncAPI válido.
- Suite completa: 196 testes da interface + 773 do servidor + 7 de contrato =
  **976 testes aprovados**, sem skips. Após a última alteração de duração de
  cancelamentos, os 45 testes dos módulos afetados também foram reexecutados e passaram.
- Chromium de regressão da Fase 2 aprovado.
- Chromium da Fase 3 aprovado com API Ollama simulada: seleção de modelo, aprovação
  humana, nove chamadas separadas, oito personagens observados durante a sua própria
  execução HTTP, memória, reinício, reconexão e desktop/mobile.
- Smoke do backend real da Fase 3 aprovado na porta local 3100. Migração SQLite v2
  aplicada com backup privado; os valores de todas as colunas e registos anteriores
  de tarefas, funcionários, definições e eventos foram comparados por hash e ficaram
  inalterados.
- Inferências com modelo local real nesta validação: **zero**. Os oito funcionários
  foram testados com simulação identificada; o escritório real não recebeu tarefas
  nem resultados de demonstração.

Mantêm-se o aviso antigo de dependência useEffect, o aviso de tamanho do bundle e
o aviso experimental do SQLite do Node 22. A suite completa E2E VS Code/Claude não
foi executada. Publicação do ambiente e restauração numa nova máquina continuam a
ser passos distintos da validação deste processo.

### Ficheiros da Fase 3

- `README.md`
- `core/src/agexa.ts`
- `core/src/intelligence.ts`
- `docs/AGEXA.md`
- `package.json`
- `scripts/agexa-intelligence-e2e.mjs`
- `scripts/agexa-smoke.mjs`
- `server/__tests__/helpers/mockOllama.ts`
- `server/__tests__/intelligenceRoutes.test.ts`
- `server/__tests__/nexusWorkflow.test.ts`
- `server/__tests__/ollamaInference.test.ts`
- `server/src/agexa/engine.ts`
- `server/src/agexa/intelligenceRoutes.ts`
- `server/src/agexa/memory.ts`
- `server/src/agexa/ollama.ts`
- `server/src/agexa/prompts.ts`
- `server/src/agexa/routes.ts`
- `server/src/cli.ts`
- `webview-ui/src/components/AgexaOffice.tsx`
- `webview-ui/src/components/IntelligencePanel.tsx`
- `webview-ui/src/index.css`
- `webview-ui/src/testHooks.ts`

## Fase 4 — CRM, prospeção autorizada e operações comerciais

Implementada sobre `agexa/phase-3`, preservando o commit de referência
`c878a9f19823e31e8176901778b92dbf72663026` e o commit posterior de capturas
`adf1140edfa12cd4428376e2ae7d071ba67573b2`. A branch de entrega é
`agexa/phase-4`; as branches anteriores continuam intactas.

O escritório original, os oito funcionários, a ponte de eventos, o editor,
a autenticação por token e o motor SQLite continuam a ser usados. As novas
animações correspondem aos estados de tarefas reais; tarefas de importação ou
regras são trabalho do backend, **não inferência IA**. Não há animações programadas
para representar inferência inexistente.

### O que funciona e como utilizar

1. Iniciar com os comandos da secção de instalação. Abrir o acesso administrativo
   mostrado pelo servidor; nunca publicar esse URL. A API CRM exige o token e
   mantém as proteções de Host/Origin anteriores.
2. Em **Prospeção**, adicionar uma fonte CSV, lista manual ou website. Identificar
   origem/evidência, atribuição, termos e permissão de reutilização comercial.
   Uma caixa marcada regista a confirmação do CEO; o sistema não verifica uma
   licença por si só. Pode pausar a fonte posteriormente.
3. Escolher a fonte, carregar um CSV ou colar a lista JSON empresarial. Confirmar
   autorização e uso apenas de dados empresariais necessários. Marcar **simulação**
   quando forem fixtures; essa classificação fica associada ao registo.
4. **Executar Hunter** cria uma tarefa persistente. O lote apresenta estado,
   resultado, IDs, duplicados e erros. Uma lista inválida não fica parcialmente
   importada. Duplicados preservam IDs e dados anteriores.
5. Em **CRM**, alternar tabela/Kanban, filtrar e abrir a ficha. Consultar fonte,
   data, necessidades, próxima ação e histórico; editar dados empresariais e
   factos conhecidos. Campos desconhecidos permanecem desconhecidos.
6. **Qualificar com Atlas** executa regras sem IA. A opção IA produz narrativa
   separada quando Ollama estiver operacional, sem substituir a pontuação por
   regras. A nota de adequação e a elegibilidade de contacto são independentes.
7. Na ficha, preparar abordagem Maya, simulação Luna, objeções Victor ou convite
   Sophia. Regras produzem materiais identificados; IA requer serviço/modelo
   verificados. Sem funcionalidades confirmadas, Maya produz briefing em vez de
   mensagem pronta. Sem URL e oferta confirmados, Sophia produz checklist.
8. Em **Marketing**, consultar versões por oportunidade, comparar textos, criar
   versões manuais e aprovar/rejeitar. Aprovar não envia nada. Versões de contacto
   externo exigem consentimento ativo para aprovação. Rascunhos vindos de servidor
   de teste ficam em modo `test` e não entram nas métricas de materiais reais.
9. Em **Comercial**, guardar funcionalidades, URL oficial, oferta de 7 dias,
   preços/políticas aprovados e limites. Os nomes lógicos `AGEXA_SIGNUP_URL`,
   `AGEXA_FREE_TRIAL_ENABLED` e `AGEXA_FREE_TRIAL_DAYS=7` correspondem à base
   administrativa já existente (`knowledge`); não são variáveis de ambiente lidas
   automaticamente. Não duplicamos nem presumimos essa configuração.
10. Em **Sales Workspace**, introduzir o objetivo Nexus, fonte e filtros explícitos
    de setor/cidade. Por exemplo: objetivo “Preparar oportunidades na Beira”,
    setor “barbearia”, cidade “Beira”. O texto livre orienta o plano, mas a seleção
    por regras usa os filtros do formulário; não interpreta geografia por IA.
    Nexus propõe um plano e aguarda **Aprovar operação comercial**. Hunter pesquisa
    registos já importados da fonte; não alega encontrar empresas novas online.
    Para descobrir novos dados, executar primeiro uma importação autorizada.

### CSV e listas

CSV UTF-8, com cabeçalho, vírgula como separador e aspas segundo RFC 4180.
Aceita BOM, campos citados, vírgulas/quebras de linha dentro de aspas e `""`.
Máximo 48.000 bytes, 30 colunas e 200 empresas por lote (ou limite menor do CEO).
Cabeçalhos desconhecidos/duplicados, colunas inconsistentes e booleanos inválidos
são recusados. Campos opcionais vazios não são inventados.

```csv
name,sector,city,province,country,website,contactChannel,businessContact,needs,usesAppointments,organizationNeed,hasSchedulingSystem,sufficientInfo
Empresa autorizada,barbearia,Beira,Sofala,Moçambique,,none,,Organizar horários,true,true,false,true
```

Esse exemplo é apenas formato, não uma empresa pesquisada. Campos aceites:
`name` (obrigatório), `sector`, `city`, `province`, `country`, `website`,
`businessPage`, `contactChannel`, `businessContact`, `needs`, `nextAction`,
`usesAppointments`, `organizationNeed`, `hasSchedulingSystem`, `sufficientInfo`.
Existem aliases portugueses, incluindo `nome`, `empresa`, `setor`, `cidade`,
`provincia`, `pais`; preferir os nomes canónicos acima. Booleanos: `true/false`,
`sim/não` (também `nao`). Canais: `none`, `website`, `email`, `whatsapp`, `business_phone`.
Um canal WhatsApp guardado é apenas dado empresarial; não cria ligação ou envio.

Listas manuais usam um array JSON com os mesmos campos. Para website, usar objeto
com `name` e `website` da mesma origem da fonte. Ver as restrições de transporte em
[AGEXA_SOURCES.md](AGEXA_SOURCES.md). Não há conector de diretório remoto ativo.

Deduplicação: nome/cidade/país normalizados ou mesmo website e cidade. Não faz
fusão automática nem substitui dados anteriores. O CEO deve resolver diferenças
reais de empresas com nomes semelhantes. Exportação CSV até 5.000 registos,
com origem, atribuição e modo; fórmulas de folha de cálculo são neutralizadas.
O contacto empresarial não é incluído nesse export.

### Qualificação, consentimento e pipeline

Regras CRM: marcações 30, setor prioritário 20, necessidade de organização 20,
ausência confirmada de sistema 10, informação suficiente 10, Moçambique explícito
10. Desconhecido soma zero. O limiar padrão é 60. As regras autónomas da Fase 2
foram preservadas; esta avaliação CRM é nova e tem histórico próprio. Alterações
de factos/setor invalidam a classificação anterior até nova avaliação.

Consentimento é um registo separado e auditável, por canal, com origem/evidência,
concessão/revogação/recusa. Publicação de telefone não equivale a consentimento.
Trocar o contacto empresarial exige novo consentimento. Uma pontuação 100 não
habilita contactos sem autorização.

As 13 etapas pedidas são persistidas. `qualified` requer nota suficiente;
`authorized` requer consentimento; `prepared` requer consentimento e abordagem
aprovada. Simulações Luna e rascunhos não avançam para conversa, interesse ou envio.

Conversa, interesse, link enviado, entrega ao CEO, conta, teste e pagamento exigem
**confirmação manual independente**, evidência e data válida. Ficam auditadas como
confirmações manuais do CEO, não como eventos automáticos do WhatsApp/Base44.
Registos simulados não podem receber essas confirmações reais. Interesse e link
exigem conversa confirmada; link exige interesse e oferta/URL confirmados; entrega
ao CEO exige link confirmado. Teste exige oferta ativa. Não há integração que
valide contas, pagamentos ou a veracidade da declaração humana.

Handoff guarda resumo, necessidades, contacto autorizado, estado da conversa/link,
URL e roteiros preparados de objeções (não são objeções ou falas reais do cliente).
O registo criado é sempre `prepared`, nunca transferência concluída automaticamente.

### Colaboração, limites e relatórios

Cada operação Nexus cria IDs e dependências reais: plano → Hunter → Atlas →
materiais por empresa → Orion → síntese Nexus. Hunter/Atlas executam operações de
dados, Orion calcula métricas; os restantes usam regras ou inferência explicitamente
selecionada. Sem resultados, cria relatório e síntese sem materiais fictícios.

Orçamento padrão da Fase 3: 12 tarefas e 10 inferências. Permite preparar materiais
para uma empresa por operação (9 tarefas por regras, ou 10 tarefas/7 pedidos ao
modelo no modo IA). Limites administrativos permitem até 3 empresas, se o orçamento
comportar. Seleção por nota, sem inventar oportunidades para ocupar funcionários.
Há no máximo cinco ordens pendentes, limite global de fila e utilização de fonte
por hora. Limites do motor continuam a aplicar-se na expansão da ordem.

Pausar funcionário, suspender operações e cancelar ordem atuam no motor existente,
com cancelamento de execução e dependências. Reinício conserva tarefas/resultados;
interrupções são tratadas pelo mecanismo de recuperação anterior. Erros permanecem
visíveis e uma etapa falhada não gera sucessos artificiais a jusante.

Relatórios separam empresas importadas/fornecidas/observadas de simulações.
Materiais internos e versões aprovadas não contam como mensagens enviadas.
Contas/testes/pagantes só contam confirmações manuais independentes; sem registos
verificados mostram **Não disponível**. Envios e receita ficam indisponíveis sem
integração. Gráficos de agentes medem tarefas operacionais, incluindo tarefas de
teste; não são produtividade comercial real nem prova de inferência.

A tabela/Kanban pagina 50 empresas; a pesquisa interna seleciona até 200 por ordem.
O snapshot e os históricos visíveis são limitados para evitar carregar toda a base;
o histórico persistido não é apagado. Esta versão destina-se a um escritório privado
com um CEO; autenticação por utilizador/organização e grande escala ficam futuras.

### Persistência e preservação verificadas

Migração aditiva SQLite v2 → v3: tabelas `crm_sources`, `crm_companies`,
`crm_qualifications`, `crm_consents`, `crm_drafts`, `crm_activities`,
`crm_handoffs`, `crm_verifications`, `crm_batches`, `crm_orders`,
`crm_assignments`, `crm_source_usage`, mais índices. `Company` agrega Lead e
SalesOpportunity para evitar duplicação. Usa a mesma ligação/SQLite, transações e
savepoints; mantém identificadores das fases anteriores.

Antes do reinício desta instância foi verificada ausência de tarefas em execução,
criada cópia SQLite consistente em `/workspace/.agexa-backups/` e calculado um
resumo criptográfico das tabelas anteriores. Após migração, todos os registos e
IDs de `employees`, `tasks`, `settings`, `events`, `workflows` e `memories`
permaneceram iguais. A base operacional não recebeu fixtures CRM. Backups e tokens
ficam fora do Git; copiar com segurança antes de futuras intervenções.

### IA, fontes e fases seguintes

Não há configuração Ollama guardada, modelo selecionado nem serviço acessível em
`127.0.0.1:11434` nesta instância. Nenhuma inferência real foi executada nem modelo
descarregado. Os testes de Atlas/Maya e colaboração IA usam API HTTP de teste,
identificada com `executionMode=test`; não comprovam qualidade de um modelo real.

Com Ollama real, configurar serviço/modelo já autorizado na Central IA, verificar
ligação, e executar tarefas IA na ficha ou operação Nexus. O modelo só devolve
JSON validado; não recebe ferramentas de shell, envio, pagamentos ou administração.
Dados de websites são não confiáveis. Contactos empresariais são omitidos do
contexto CRM enviado ao modelo.

CSV/listas funcionam nesta nuvem. URLs têm adaptador seguro, mas não foram validadas
em sites externos reais: o transporte de proxy não garante DNS fixado e é recusado.
OSM foi investigado sob ODbL, sem API ativada nem termos/quotas do operador assumidos.
Ver [fontes e evidência](AGEXA_SOURCES.md).

WhatsApp, envio após aceitação, recibos de entrega, bloqueio de automação após
handoff, cadastro Base44 e pagamentos continuam para fases futuras com integração
e autorização próprias. Não há processos de marcação de demonstrações.

### Validação da Fase 4

Executar com Node 22, sem reutilizar a base operacional nos testes:

```bash
npm run build
npm run lint
env -u AGEXA_DATA_DIR npm test
npm run asyncapi:validate
npm run test:smoke
AGEXA_CHROMIUM_PATH=/usr/bin/chromium npm run test:agexa:e2e
AGEXA_CHROMIUM_PATH=/usr/bin/chromium npm run test:agexa:intelligence:e2e
AGEXA_CHROMIUM_PATH=/usr/bin/chromium npm run test:agexa:crm:e2e
```

O smoke requer o standalone na porta 3100. Os cenários Chromium criam servidores e
bases temporárias próprias. O CRM e2e usa empresas fictícias explicitamente
simuladas; o e2e de inteligência usa Ollama simulado. A variável
`AGEXA_SCREENSHOT_DIR` guarda capturas desses cenários, sem tokens nos nomes/URLs
mostrados. Ver [capturas no GitHub](screenshots/README.md).

Resultados em 24/10/2026:

- Build, tipos e lint aprovados. Mantêm-se os avisos anteriores de dependência de
  useEffect, bundle acima de 500 kB e SQLite experimental.
- **1.018 testes aprovados**: 196 interface + 815 servidor + 7 contratos do pacote.
  São os 976 anteriores mais 42 testes CRM. Nenhuma suite antiga foi removida.
- AsyncAPI válido, smoke HTTP/WebSocket e arranque após migração aprovados.
- Chromium Fase 2: login privado, oito personagens, controlos, editor, suspensão,
  persistência/reconexão e desktop/mobile aprovados.
- Chromium Fase 3: nove pedidos a Ollama simulado, oito personagens com animações
  ligadas ao backend e persistência/reconexão aprovados; sem inferência real.
- Chromium Fase 4: CSV, duplicados, nota/consentimento separados, versões,
  transições protegidas, Nexus, relatórios e reinício aprovados, desktop/mobile
  sem transbordamento do painel. Dados empresariais exclusivamente simulados.
- Operação CRM IA adicional em integração: oito funcionários, dez tarefas, sete
  pedidos HTTP ao emulador, quatro versões internas em modo teste, zero envios.
- Migração automatizada e comparação da base operacional confirmaram preservação
  dos registos anteriores; sem fixtures na base operacional.
- Licença e package-lock originais inalterados; nenhuma dependência adicionada.
- VS Code/Claude E2E completo e restauração numa nova tarefa não foram executados.

O `install_script` continua válido e inalterado. O `start_skill` do ambiente é
atualizado para esta fase, com arranque, migração, limitações e checks. Guardar um
rascunho e fazer push não publica o ambiente: rever/guardar nas definições e depois
publicar pelo produto. Não foi anunciada publicação nem restauração futura validada.

## Fase 5 — WhatsApp Sales Center e atendimento aprovado

Continuação do commit `1b2d872869e8ca027d352ffaa1eba0ca97a576c7`, em
`agexa/phase-5`. Foram preservados o escritório, editor, oito funcionários,
autenticação, CRM, tarefas, IDs e branches anteriores. Não houve force-push.

Conector experimental implementado, mas ligação real não validada.

O painel privado tem agora **WhatsApp Center**: estado/capacidades da conexão,
configuração, QR privado quando aplicável, inbox pesquisável/paginada, associação
explícita ao CRM, histórico, notas, responsável, versões de respostas, aprovação e
envio individual, reconciliação, transferência humana e eventos em tempo real.

O atendimento padrão é assistido; também existe modo manual. Em ambos, envio pelo
conector experimental exige aprovação humana da versão exata e confirmação
individual. A edição cria nova versão. Mensagem recebida depois da preparação
invalida a versão anterior para aprovação/envio. O modo automático está bloqueado.
A inbox não permite disparos ou contacto a números encontrados pelo Hunter.

Ver [manual completo, QR, modos e limites](AGEXA_MESSAGING.md).

### Providers e execução real

`MessagingProvider` desacopla os agentes/CRM da biblioteca de WhatsApp:

- Mock completo, exclusivo de testes isolados, com conteúdo/métricas simulados.
- `WhatsAppWebExperimentalProvider`, baseado em `whatsapp-web.js` 1.34.7,
  LocalAuth e eventos de texto/QR/estado/aceitação. Desligado por omissão;
  confirmação administrativa e número de testes exigidos.
- `WhatsAppCloudApiProvider`: contrato/stub, sem transporte, credenciais ou webhook.

A biblioteca experimental é opcional; `qrcode` produz a imagem no backend.
O lockfile foi atualizado de forma intencional e a instalação reproduzida com:

```bash
PUPPETEER_SKIP_DOWNLOAD=true HUSKY=0 npm ci --cache /workspace/.npm-cache
npm run build
```

Não houve download de navegador/modelo nem API paga. Para ligar QR, configurar
`AGEXA_WHATSAPP_CHROMIUM_PATH` para um Chromium existente, reiniciar o servidor,
configurar e confirmar o canal experimental, ligar e associar pelo telefone em
**Dispositivos associados → Associar dispositivo**. Não usar o número principal.
Conservar sandbox/TLS e as regras de rede; não contornar restrições desta nuvem.
Sessão em `AGEXA_DATA_DIR/messaging-auth`, fora de Git, protegida a 0700.
QR efémero não é persistido, transmitido em WebSocket ou publicado em logs.

O cliente é não oficial e pode sofrer restrições ou bloqueio. Sem histórico remoto,
grupos, anexos ou resolução automática de identificadores `@lid`; a prova de
conceito trata mensagens de texto individuais `@c.us`. A deteção humana é parcial,
logo não permite ativar automático. O encerramento normal aguarda o browser; a
reconexão é explícita e conserva LocalAuth. Revogação tenta logout e remove a sessão
local; confirmar também no telefone. Uma conta diferente da inbox é bloqueada.

### Integração com os funcionários e CRM

Os oito funcionários executam tarefas reais na fila existente, com dependências e
eventos que conduzem as animações. Sem Ollama, operam com regras/rascunhos manuais
identificados. IA é opcional por tarefa e não tem fallback simulado em produção.
Só o CEO pode aprovar ou enviar; a IA não altera consentimento/políticas.

Sophia reutiliza a configuração comercial existente. Exige URL/oferta/sete dias
confirmados, interesse e aceitação do link declarados pelo CEO com evidência numa
mensagem recebida. Um número publicado ou uma nota alta nunca concede consentimento.
No envio, são revalidados canal, contacto, consentimento, versão, conhecimento,
responsabilidade e suspensão. Simulações e resultados de modelo de teste não podem
ser enviados como conteúdo real a uma conversa real.

Uma transação cria a entrega antes da chamada ao provider. Há idempotência por
provider/ID e por rascunho, com lock persistente por conversa. ID sem confirmação
fica pendente. A confirmação usada é aceitação do servidor/provider, não leitura.
Erro/timeout/reinício sem certeza exigem reconciliação manual e nunca retry cego.

Após convite confirmado, a conversa passa ao CEO, agentes ficam bloqueados,
participação pendente é cancelada e é emitida notificação. Em dados reais, há
atualização auditada do CRM e resumo; dados simulados não ganham etapas reais.
Isto não confirma conta criada, teste ativo ou pagamento. A intervenção humana
observada e o botão de transferência também bloqueiam agentes. Pedidos reconhecidos
de não contacto revogam o consentimento do canal. Formulações não reconhecidas
continuam a exigir revisão humana.

**PARAR TODA A AUTOMAÇÃO** suspende motor/canal e cancela tarefas de conversa
elegíveis, sem destruir dados. Não retira um envio já entregue ao provider;
o resultado deve ser confirmado ou reconciliado.

### Persistência e validação

Migração aditiva SQLite v3 → v4 acrescenta nove tabelas de conexão, conversa,
mensagem, versão, aprovação, entrega, atribuição, eventos e auditoria. Estado
persistente do provider integra a conexão; QR e ligação ativa não são presumidos
após reinício. Company e consentimentos permanecem no CRM por ID.

Foi criado backup consistente privado antes das alterações, com hashes de todas
as tabelas existentes, incluindo CRM. A base operacional não recebeu fixtures,
contas ou mensagens de teste. A comparação após migração confirmou hashes/IDs iguais em todas as tabelas
anteriores, e o smoke HTTP/WebSocket passou após o arranque com schema v4. Nenhuma sessão, token ou conversa real vai para Git.

Checks da fase: build/tipos/lint, npm test, AsyncAPI, smoke e quatro cenários
Chromium (Fases 2–5). A suite tem **1.057 testes**: 196 interface + 854 servidor +
7 contratos; preserva os 1.018 anteriores e acrescenta 39. O teste antigo de migração
continua a comparar os dados anteriores; a versão esperada foi atualizada para v4.
Mantêm-se os avisos anteriores de useEffect, bundle e SQLite experimental.

O novo cenário `npm run test:agexa:messaging:e2e` usa backend real, SQLite e
mensagens fictícias com provider simulado: associação CRM, Luna por regras,
aprovação da versão, envio simulado, rejeição, Sophia, CEO, suspensão, reinício e
renderização desktop/mobile. Não executa inferência. Os testes QR usam cliente de
navegador injetado; os testes IA usam emulador Ollama. Não comprovam autenticação
WhatsApp, entrega externa ou inferência com modelo real.

Ollama continua inacessível em `127.0.0.1:11434`; zero inferências reais nesta fase.
Uma futura validação exige serviço/modelo autorizado existente e número de testes
com rede permitida. A API oficial, webhooks assinados, anexos/histórico remoto e
validação de produção ficam pendentes. A Fase 6 poderá aprofundar integração e
reconciliação transacional após teste real autorizado, sem inferir cadastros ou vendas.

O `install_script` passa a incluir `PUPPETEER_SKIP_DOWNLOAD=true`; o `start_skill`
é atualizado para a Fase 5. Rascunho guardado não significa ambiente publicado;
rever/guardar nas definições e publicar pelo produto. Restauração numa nova tarefa
continua sem validação independente.
