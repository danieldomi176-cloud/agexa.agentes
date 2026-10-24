# AGEXA WhatsApp Sales Center — Fase 5

Conector experimental implementado, mas ligação real não validada.

Nenhuma conta WhatsApp foi autenticada, nenhum número real foi usado e nenhuma
mensagem foi enviada a pessoas durante esta implementação. Ollama local continua
indisponível. Testes de IA usam emulador HTTP e testes de mensagens usam provider
simulado ou cliente de navegador injetado em diretórios temporários.

## Abrir e utilizar

Iniciar o standalone com Node 22 e `AGEXA_DATA_DIR` absoluto, privado e fora de Git:

```bash
export PATH=/workspace/.tooling/node22/node_modules/node/bin:$PATH
cd /workspace/agexa.agentes
export AGEXA_DATA_DIR=/workspace/.agexa-data
unset AGEXA_MESSAGING_TEST_MODE AGEXA_INFERENCE_TEST_MODE
npm run start:agexa
```

Entrar com o acesso administrativo privado e abrir **WhatsApp Center**. O canal
inicia desativado. Não é ligado automaticamente após reinício. O URL administrativo,
token, QR e sessão são segredos; não publicar logs, capturas de QR ou estado real.

**Manual:** o CEO consulta mensagens, escreve um rascunho, guarda uma versão,
aprova essa versão e confirma o envio individual. A edição cria uma nova versão,
que precisa de aprovação própria. Copiar texto não regista envio.

**Assistido (padrão):** abrir “Trabalho dos funcionários”, escolher Luna, Victor ou
outro funcionário e preparar material interno. Selecionar inferência apenas se
Ollama/modelo estiverem verificados; não existe fallback oculto. Sem IA, as operações
por regras são identificadas como tal. As sugestões são pedidas pelo CEO; mensagens
recebidas não desencadeiam envios nem inferência por si próprias.

“Nexus: coordenar equipa” cria oito tarefas dependentes, uma por funcionário.
Hunter não extrai números nem inicia contacto; Atlas usa os factos da empresa
associada; Maya/Luna/Victor preparam materiais; Sophia verifica oferta e aceitação;
Orion apresenta métricas registadas. Não é uma campanha ou disparo para uma lista.
Os personagens trabalham apenas durante a execução dessas tarefas pelo backend.

**Automático:** bloqueado para todos os providers desta fase. O contrato permite
futura implementação, mas nem a integração não oficial nem o stub oficial possuem
transporte/políticas/deteção humana validados para ativação. O botão não ultrapassa
essa verificação. Não é possível enviar por uma tarefa ou resultado do modelo.

## Associar ao CRM e preparar convite

A inbox contém apenas conversas recebidas. Não há formulário para carregar números
prospetados e enviar publicidade. A associação ao CRM é explícita: a empresa deve
ter o mesmo contacto empresarial WhatsApp, com número internacional sem ambiguidades.
Não se faz fusão automática. A lista do seletor mostra a página inicial do CRM;
também se pode introduzir o ID de outra empresa encontrada no CRM.

Antes de aprovar/enviar, registar consentimento WhatsApp na ficha CRM com origem
e evidência. O consentimento é verificado novamente no momento do envio. Receber
uma pergunta ou publicar um telefone não concede automaticamente consentimento
comercial. Dados simulados só podem ser associados a empresas simuladas.

Para convite Sophia:

1. Confirmar em **Comercial/Conhecimento** o URL HTTPS oficial, oferta ativa e sete
   dias. Reutiliza a configuração existente; não há uma segunda base de conhecimento.
2. Na conversa, selecionar a mensagem recebida que comprova interesse e registar
   evidência/confirmar a declaração do cliente.
3. Registar também aceitação expressa de receber o link, ligada a uma mensagem
   recebida. São decisões auditadas do CEO, não permissões atribuídas pela IA.
4. Pedir material Sophia ou escrever uma versão de tipo convite. Sem essas condições,
   Sophia gera apenas checklist interno, não um convite pronto.
5. Aprovar a versão exata e confirmar o envio individual. Mensagem nova recebida
   depois de criar o rascunho exige versão atualizada antes de aprovar/enviar.

Textos são validados contra URL, oferta e preços aprovados. O modelo recebe contexto
limitado de mensagens não confiáveis, sem número/JID do interlocutor no contexto
estruturado da conversa; nunca recebe ferramentas de envio, pagamentos ou administração.
Dados que o próprio cliente escrever no corpo da mensagem continuam conteúdo externo
não confiável. Não há garantia de qualidade de geração sem validação com um modelo real.

## Ligar um número de testes por QR

`whatsapp-web.js` 1.34.7 é uma dependência opcional. `qrcode` gera a imagem localmente.
Usar **apenas número de testes**, nunca o principal do Agexa. A implementação é um
cliente não oficial; a autorização do administrador não significa aprovação da Meta.
Pode deixar de funcionar, violar condições aplicáveis ou sofrer bloqueio da conta.
Não há mecanismos de evasão, envio em massa ou bypass de restrições.

Instalação reproduzível sem descarregar Chromium automaticamente:

```bash
PUPPETEER_SKIP_DOWNLOAD=true HUSKY=0 npm ci --cache /workspace/.npm-cache
npm run build
```

Configurar `AGEXA_WHATSAPP_CHROMIUM_PATH` para um Chromium instalado e compatível,
por exemplo `/usr/bin/chromium` numa máquina onde esse binário exista. Reiniciar o
backend com essa variável. O conector conserva o sandbox e a verificação TLS;
não adiciona `--no-sandbox`, `--disable-web-security` ou equivalentes. O proxy HTTP
herdado é encaminhado ao navegador quando configurado; proxies com credenciais no
URL são recusados. Não remover proxies nem ignorar certificados para forçar ligação.

Nesta nuvem, não foi autorizada/configurada rede WhatsApp nem fornecido um número
de testes. Não foi tentada autenticação real ou validada compatibilidade do sandbox
com o serviço remoto. Para operar noutra máquina, é necessário Chromium funcional,
acesso de rede permitido ao WhatsApp Web e aceitação dos riscos pelo administrador.
Esta implementação não declara uma lista completa de domínios necessários.

No painel:

1. **Configurar canal** → WhatsApp Web experimental.
2. Confirmar utilização de número de testes e risco do cliente não oficial.
3. Guardar configuração; confirmar novamente ao **Ligar canal**.
4. No WhatsApp Business do telefone: **Definições → Dispositivos associados →
   Associar dispositivo**. Digitalizar o QR privado mostrado no painel.
5. Estados são distintos: a ligar, QR, autenticado e ligado. Só “ligado” permite
   solicitar envio. Um QR atualizado substitui o anterior; QR expirado é recusado.
6. Retomar o canal e usar exclusivamente respostas individuais autorizadas.

LocalAuth guarda a sessão em `AGEXA_DATA_DIR/messaging-auth/session-agexa-test`,
com diretório protegido a 0700; o servidor deve arrancar com `umask 077`.
A aplicação recusa sessão dentro de checkout Git e diretório de sessão por symlink.
O QR só existe em memória, é obtido por endpoint autenticado sem cache e nunca é
incluído no WebSocket, SQLite ou logs da aplicação. O telefone associado só aparece
quando disponibilizado pelo provider.

**Desligar canal** fecha o browser e conserva LocalAuth. Reconectar é uma ação
administrativa explícita; não existe ciclo automático de tentativas. **Revogar sessão**
tenta logout remoto e elimina o perfil local conhecido; se falhar, mostra erro.
Confirmar também a revogação em Dispositivos associados no telefone. O encerramento
normal do CLI/servidor aguarda a desconexão do navegador.

Uma inbox deste provider fica vinculada à primeira conta identificada. Uma conta
diferente é bloqueada para evitar misturar históricos; usar outro diretório privado
de dados para outro número. Revogação não apaga mensagens/auditoria comerciais.

## Capacidades e limitações

| Provider | Situação | Limitações |
| --- | --- | --- |
| MockWhatsAppProvider | Completo em testes isolados | Sem conta/QR real/envio externo; mensagens e métricas marcadas como simuladas. Disponível por HTTP apenas com `AGEXA_MESSAGING_TEST_MODE=1` no processo de teste. |
| WhatsAppWebExperimentalProvider | Adaptador real implementado, autenticação real não validada | Texto individual `@c.us`, novos eventos e confirmação de aceitação quando emitida. Sem histórico remoto, grupos, anexos ou resolução automática `@lid`; mensagens desses tipos não são importadas. |
| WhatsAppCloudApiProvider | Contrato/stub explícito | Sem transporte, credenciais, webhook ou envio. Uma futura integração exige API oficial, assinaturas, idempotência, políticas e validação próprias. |

A deteção de mensagens manuais em `message_create` é parcial: eventos durante um
envio próprio não permitem distinguir com segurança um envio paralelo no telefone.
Por isso `reliableHumanDetection=false` e automático permanece bloqueado. Quando um
evento manual é observado, a conversa passa ao CEO e tarefas elegíveis são canceladas.
O CEO também pode transferir manualmente a qualquer momento.

## Envio, confirmação e transferência

Aprovação e envio são ações separadas. O registo de aprovação identifica o CEO e a
versão imutável. Antes da chamada externa, uma transação persiste mensagem e entrega
com chave única por rascunho e lock persistente por conversa. Não há dois envios
pendentes simultâneos na mesma conversa.

Um ID devolvido sem confirmação suficiente fica **pending**, sem contar como envio
confirmado. A confirmação implementada é aceitação pelo servidor/provider (`ack >= 1`),
não prova de entrega ao telefone ou leitura. Eventos repetidos não duplicam o efeito.
Erro, timeout ou interrupção após tentativa podem significar que o envio ocorreu;
o estado passa a **reconciliation**, sem reenvio automático. Reiniciar não repete
operações incertas. Usar “Reconciliação de envios” com evidência independente para
confirmar envio ou confirmar que não foi enviado. Isso é uma declaração auditada do
CEO, não um recibo novo do provider. O rascunho antigo não é reenviado após falha.

Após confirmação de um convite, a transação regista envio, atribui conversa ao CEO,
bloqueia materiais dos agentes, cancela participação elegível e notifica por evento.
Para dados reais, regista evidência e etapa **ENTREGUE AO CEO** no CRM e prepara um
resumo interno. Para dados simulados, a atribuição é só do cenário de teste e não
marca conversão/conversa real no CRM. Não cria conta, teste ativo ou cliente pagante.
O CEO pode abrir o contacto pelo link `wa.me`, conforme o cliente instalado no telefone.

Uma intervenção humana bloqueia agentes até devolução **explícita** da conversa.
Pedidos de não contacto reconhecidos bloqueiam a conversa e revogam consentimento
WhatsApp no CRM; o CEO deve tratar também pedidos formulados de outras maneiras,
porque esta fase não promete compreensão automática de toda a linguagem natural.

**PARAR TODA A AUTOMAÇÃO** suspende o motor e o canal, cancela tarefas de conversa
pendentes elegíveis e preserva o histórico. Um pedido já entregue ao provider não
pode ser retirado: manter o registo e confirmar/reconciliar o resultado. Retomar o
canal não retoma o motor global automaticamente.

## Módulos, migração e testes

- `core/src/messaging.ts`: contratos partilhados, capacidades e modos.
- `server/src/agexa/messaging/`: providers, store SQLite, serviço e rotas privadas.
- `webview-ui/src/components/MessagingPanel.tsx`: inbox, versões, revisão, QR e controlo.
- Motor existente: tarefas, dependências, Ollama, eventos e animações preservados.

Migração aditiva v3 → v4: `messaging_connections`, `messaging_conversations`,
`messaging_messages`, `messaging_drafts`, `messaging_approvals`,
`messaging_deliveries`, `messaging_assignments`, `messaging_events`,
`messaging_audit`. Estado persistente do provider é agregado à conexão; estados
transitórios/QR não são confundidos com sessão autenticada após reinício. Company e
consentimento continuam no CRM, associados por ID, sem duplicação.

Índices únicos garantem idempotência por provider/ID e lock de entrega por conversa.
Todas as rotas herdam autenticação administrativa e proteção Host/Origin. Não há
webhook público nem endpoint de injeção de mensagens em produção. O endpoint do
Mock só é registado em modo de testes isolado; nunca ativar esse flag na base do CEO.
A inbox pagina 30 conversas, o histórico 50 mensagens, versões/auditoria visíveis
são limitadas; os registos persistidos não são apagados.

```bash
npm run build
npm run lint
env -u AGEXA_DATA_DIR npm test
npm run asyncapi:validate
npm run test:smoke
AGEXA_CHROMIUM_PATH=/usr/bin/chromium npm run test:agexa:messaging:e2e
```

Manter também os e2e das Fases 2, 3 e 4. O smoke requer o standalone na porta 3100.
Os testes de inbox/IA/browser usam dados temporários; o cenário Chromium de mensagens
não executa inferência nem envia mensagens externas. `AGEXA_SCREENSHOT_DIR` permite
guardar capturas fictícias, sem QR ou sessões reais. Ver [capturas](screenshots/README.md).

Fontes técnicas consultadas: [whatsapp-web.js 1.34.7](https://github.com/pedroslopez/whatsapp-web.js/tree/v1.34.7),
[LocalAuth](https://github.com/pedroslopez/whatsapp-web.js/blob/v1.34.7/src/authStrategies/LocalAuth.js)
e [eventos do cliente](https://github.com/pedroslopez/whatsapp-web.js/blob/v1.34.7/src/Client.js).
As bibliotecas mantêm as suas licenças e dependências; a licença MIT do projeto
original permanece inalterada. O provider opcional inclui dependências upstream
marcadas como descontinuadas; não se trata de integração de produção validada.
