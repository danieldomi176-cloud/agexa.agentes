# Entrega — servidor preparado para publicação

**Nenhum deploy Render/Base44 foi efetuado e nenhum serviço pago foi contratado.**
Branch: `agexa/stage-1-deploy`, derivada de `agexa/base44-integration` em
`3e56012e3fe865dee181ce8ec6d8054e166e83be`. O commit final consta do histórico da branch.

## Implementação

- Entrada `dist/hosted.js`/`npm run start:hosted` com PORT, TLS terminado pelo host
  autorizado, rotas públicas fechadas e motor original em loopback.
- Montagem persistente exigida em Render; recusa de disco efémero, base ausente e
  configuração de acesso incompleta. Manutenção para restaurar os dados anteriores.
- Backups pelo serviço original, consistentes, privados e verificados, no arranque
  e a cada seis horas; conservação de cinco cópias. Não é backup externo a desastres.
- API administrativa por BFF Base44, autenticação por sessão/ID e HMAC de curta
  validade, scopes, nonce único, limites, idempotência e auditoria no mesmo SQLite.
- Serviços/endpoints comerciais reutilizados; extensões de leitura para paginação
  de tarefas, workflows e relatórios. Nenhum novo agente, dashboard, CRM ou banco.
- Configuração Render para revisão manual, sem plano pago/criação automática;
  contrato OpenAPI e artefactos únicos Base44 prontos para a próxima etapa.

## Testes e preservação

**1.204 aprovados**: 196 interface, 1.001 servidor e 7 contratos de pacote.
Os 1.154 anteriores foram mantidos; 50 novos testes. Build, tipos, lint, AsyncAPI,
correspondência dos artefactos e smoke aprovados. Avisos anteriores de useEffect,
bundle e SQLite experimental mantêm-se.

Regressões Chromium anteriores e cenário CEO passaram. Cenário hosted validou
PORT, backend original, sessão fictícia no BFF, CA/hostname TLS verificados,
negação de certificado/login inválidos, oito funcionários reais, suspensão,
bloqueio de rotas públicas, backups 0600 com integrity_check e reinício mantendo
estado/token. São testes locais isolados; não comprovam Base44/Render reais.

Backup consistente privado antes das alterações. O backend operacional temporário
foi reiniciado com publicação desativada: todas as tabelas/IDs anteriores tiveram
hash idêntico, integrity_check aprovado, oito funcionários e autenticação privada
preservados. Não se introduziram dados de teste, mensagens, contas ou pagamentos
reais. As tabelas de metadata CEO não foram criadas na base operacional desativada.

Instalação limpa/recuperação foi validada na mesma máquina; não é restauração numa
máquina independente. VS Code/Claude E2E, Chromebook físico, login Base44 real,
compilação Deno no serviço, Caddy em execução e disco/HTTPS público Render não
foram validados. Sintaxe systemd verificada com o caminho Node local substituído;
os caminhos de host do template ainda exigem revisão real.

## Configuração e próxima etapa

Ler [AGEXA_STAGE1_DEPLOY.md](AGEXA_STAGE1_DEPLOY.md). Contém os campos Render,
variáveis, manutenção/restauro, proteção de segredos e critérios de aceitação.
`deploy/render/service.json` é configuração manual, não um Blueprint autoexecutável.
Render Free efémero não serve este SQLite; se o plano exigir pagamento, parar.
Nenhuma chave, User ID CEO ou URL de produção foi inventado/configurado como real.

Principais ficheiros: `server/src/hosted.ts`, `server/src/agexa/ceo/`,
`server/src/{httpServer,cli}.ts`, leituras em `server/src/agexa/{engine,routes}.ts`,
`core/src/ceoBridge.ts`, `integrations/base44/office-*` e artefactos de BFF/cliente,
`deploy/render/service.json`, templates `deploy/ceo/`, build/scripts/testes e
`docs/AGEXA.md`. A lista completa e o diff estão no commit GitHub.
