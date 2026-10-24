# Etapa 1 — publicar o servidor existente

**Código preparado; nenhum deploy real efetuado.** Base: branch
`agexa/base44-integration`, commit `3e56012e3fe865dee181ce8ec6d8054e166e83be`.
Branch desta entrega: `agexa/stage-1-deploy`. Mantidos agentes, Nexus, CRM, SQLite,
IA, mensagens, aprovações, relatórios e Pixel Agents. Não foram criados agentes,
dashboards ou funcionalidades comerciais novos.

## O que foi preparado

`npm run start:hosted` inicia `dist/hosted.js`: uma entrada de publicação que escuta
**0.0.0.0:$PORT** e mantém o CLI original numa porta privada de loopback. Existe só
**um motor comercial e um sales.sqlite**. A entrada pública não tem terminal,
shell, hooks, SPA, ficheiros ou rotas administrativas legadas.

Publica somente:

- GET `/healthz`: prontidão mínima, sem PID, tokens ou dados comerciais.
- POST `/api/ceo/v1/request`: API assinada exclusivamente backend Base44 → Office.

Restantes rotas, query-token e upgrades WebSocket são recusados, mesmo com o token
legado. A rota administrativa só aceita o Host configurado, HTTPS indicado pelo
terminador autorizado, sem Origin de browser e com HMAC/identidade/allowlist válidos.
Em Render, o modo exige metadados da plataforma e disco montado não efémero.
Em servidor próprio, exige IP exato do proxy e confirmação explícita da persistência.
Não se altera TLS ou proxy de saída para contornar a rede.

O contrato fechado e o BFF autenticado já preparados reutilizam serviços/aprovações.
Não existe URL arbitrário, SQL ou terminal nesse contrato. O browser não recebe
chave da ponte ou token permanente do Office. Consultar
[contrato real e OpenAPI](AGEXA_CEO_API.md). O artefacto Base44
`integrations/base44/deploy/agexaOfficeAdmin.ts` fica preparado para a próxima etapa;
não foi publicado nem ligado ao site real nesta entrega.

## Render e restrição de custos

**Render Free, com disco efémero, não satisfaz a persistência exigida para este
SQLite.** Discos persistentes têm elegibilidade/plano próprios e normalmente custo.
As páginas atuais de documentação/preços foram recusadas pelo proxy desta sessão
(CONNECT 403); não se inventou preço nem se contratou nada.

Antes de criar, verificar no painel real se o plano disponível permite disco
persistente **sem cobrança**. Se exigir plano pago/upgrade/cartão, **parar** segundo
a instrução do CEO. Não publicar uma versão com SQLite efémero para aparentar que
funciona. Alternativa: servidor já disponível com disco durável e Node 22, sem
contratar serviço novo. Os templates `deploy/ceo/` apoiam essa alternativa.

`deploy/render/service.json` é uma configuração **para revisão manual**, não um
Blueprint que crie recursos automaticamente. Não se incluiu um plano pago nem
ficheiro de auto-criação com cobrança implícita. Nenhum serviço Render foi criado.

## Passos exatos da próxima etapa

1. Abrir o painel Render autorizado e verificar primeiro o ponto de custos/disco
   acima. Só continuar se satisfizer a instrução de não contratar serviços pagos.
2. Preparar um Web Service nativo **Node** com o repositório do CEO e branch
   **agexa/stage-1-deploy**, raiz `.`. Uma instância, deploy automático desativado.
3. Configurar os campos:

   | Campo | Valor |
   | --- | --- |
   | Build Command | `PUPPETEER_SKIP_DOWNLOAD=true HUSKY=0 npm ci --include=dev && npm run build && npm run base44:check` |
   | Start Command | `npm run start:hosted` |
   | Health Check Path | `/healthz` |
   | Persistent Disk mount | `/var/data`, volume durável confirmado |
   | Node | `NODE_VERSION=22.23.4` |

4. Configurar as variáveis não secretas de `deploy/render/service.json`:
   `NODE_ENV=production`, `PUPPETEER_SKIP_DOWNLOAD=true`,
   `AGEXA_TLS_TERMINATION=render`, `AGEXA_CEO_BRIDGE_ENABLED=1`,
   `AGEXA_PERSISTENT_ROOT=/var/data`, `AGEXA_DATA_DIR=/var/data/agexa`,
   **`AGEXA_MAINTENANCE=1` inicialmente**.
   `PORT`, `RENDER` e `RENDER_EXTERNAL_URL` são fornecidos pela plataforma:
   não inventar valores. Sem override, a origem HTTPS usa o URL real da plataforma.
5. Preparar um backup consistente dos **dados anteriores**, com acesso privado.
   No corte final, suspender operações e parar graciosamente a origem antes da
   cópia final; promover só um destino, sem dois motores ativos sobre cópias dos
   mesmos dados. Conservar a origem desligada até verificar restauração e IDs. Não usar GitHub/chat para
   transferir SQLite, token ou sessões. Não copiar SQLite vivo sem WAL; usar o
   backup SQLite e transferir configuração/sessões privadas de forma consistente.
6. O modo manutenção permite o primeiro arranque para preparar/restaurar o volume:
   `/healthz` devolve `{ready:false,maintenance:true}` com HTTP 200; toda a API de
   agentes fica 503 e o motor **não arranca**. Isto não é serviço operacional.
   Usar exclusivamente o acesso **privado do proprietário** suportado pelo host
   para restaurar a pasta anterior em `/var/data/agexa`. Confirmar no plano/conta
   o canal de transferência disponível (não foi observado neste painel).
   Não criar endpoint de upload/download de base, shell ou terminal públicos.
7. Após copiar, verificar `sales.sqlite` com `PRAGMA integrity_check`, versão/IDs e
   hashes das tabelas; diretório 0700 e ficheiros privados 0600. Preservar token e
   autenticação/sessões existentes; não substituir por fixtures. Não transferir
   `sales.lock` ou registos PID da máquina anterior: são estado de processo. Se
   encontrar um lock no destino, inspecionar o dono/processo antes de o retirar;
   nunca apagar lock vivo nem WAL/SHM de uma base aberta. A entrada normal
   **recusa arranque sem sales.sqlite existente**, evitando reiniciar o projeto vazio.
8. No gestor de segredos do Render, guardar `AGEXA_CEO_BRIDGE_SECRET` bruto, forte,
   exclusivo da ponte (≥32 caracteres), por canal seguro. Guardar a mesma chave no
   backend Base44 na próxima etapa. Nunca no Git, frontend ou chat. Não reutilizar
   `AGEXA_BASE44_EVENT_SECRET` do feed comercial. Se usar variável bruta, deixar
   `AGEXA_CEO_BRIDGE_SECRET_FILE` ausente para não haver fontes ambíguas.
9. Configurar `AGEXA_CEO_CONTROL_IDS` com o **User ID imutável real do CEO Base44**.
   O App ID `6970e6a789a360f2b09ea09d` não é esse User ID. Leitores opcionais usam
   `AGEXA_CEO_READ_IDS`. Preservar as variáveis existentes de IA/feed/WhatsApp;
   não ativar inferência, mensagens ou oferta para validar publicação.
10. Retirar `AGEXA_MAINTENANCE=1` (usar 0) e reiniciar/deploy manual. O backend
    valida disco, configuração e chave, inicia o servidor original, cria backup
    consistente verificado e só então abre PORT para a API. Chave/IDs inválidos,
    disco ausente/efémero ou base não restaurada impedem publicação operacional.
11. Copiar o **URL HTTPS realmente atribuído** pelo serviço. Não usar o endereço
    `agexa-flix.base44.app` como se fosse o host Node. Verificar certificado e
    `/healthz` com `{ready:true}`, sem desativar TLS. Testar também pedidos sem
    assinatura/identidade e rotas legadas: devem ser recusados.
12. Na próxima etapa, configurar a função backend Base44 com essa origem real,
    chave e allowlist, segundo [o contrato](AGEXA_CEO_API.md) e
    [instruções do BFF](AGEXA_BASE44_CEO_FRONTEND.md). Não expor chave ou token no
    browser. A mera saúde HTTP do Render não prova ligação ao site Base44.

Se não existir disco persistente sem custo no plano disponível, a publicação fica
pendente; o código continua preparado para um host persistente autorizado. Não
se alterou essa restrição para conseguir um URL temporário.

## Backups e reinícios

O modo hosted usa **o serviço de backup já existente**, pela API interna privada.
Cria backup consistente no arranque normal e a cada seis horas, verifica integridade
e conserva cinco cópias conhecidas, com permissões privadas em `AGEXA_DATA_DIR/backups`.
Falha de backup retira a prontidão de publicação; não se apresenta proteção inexistente.

Cópias no mesmo volume ajudam a recuperar erros locais, mas não são backup externo
a desastres. Antes de uso operacional, definir cópia privada fora do host e testar
restauro; não se configurou armazenamento externo pago ou transmissão de dados nesta
etapa. Manter um escritor, volume local adequado ao SQLite e encerramento gracioso.
O supervisor encerra o filho ao receber SIGTERM; a recuperação original conserva
histórico e não repete automaticamente tarefas/interações incertas.

## Validação reproduzível

No host de desenvolvimento Node 22 (não no Chromebook):

```sh
npm run build
npm test
npm run base44:check
npm run asyncapi:validate
AGEXA_CHROMIUM_PATH=/usr/bin/chromium npm run test:agexa:hosted:e2e
```

O teste hosted usa backend original real, PORT, proxy TLS com CA de teste validada,
BFF com sessão fictícia, bloqueio de rotas, backup e reinício com a mesma pasta.
**Não é deploy Render, disco de produção ou autenticação Base44 real.**
Não há serviço online declarado nesta entrega.
