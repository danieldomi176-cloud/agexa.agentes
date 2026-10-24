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
