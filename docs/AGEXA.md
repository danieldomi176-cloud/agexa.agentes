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

O repositório remoto Agexa estava vazio, sem branch main. Os ficheiros importados
e as alterações estão no checkout local para revisão, sem commit nem push.
A configuração guardada não é publicação; rever e guardar nas definições e depois
publicar o ambiente. A restauração numa nova tarefa ainda não foi validada.
