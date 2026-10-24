# Base44 — estado da integração

**Código preparado; ligação à aplicação real ainda não autenticada.** Não houve
acesso ao editor nem publicação de funções, entidades, permissões ou eventos reais.

- Aplicação: https://agexa-flix.base44.app/
- App ID confirmado pelo CEO: **6970e6a789a360f2b09ea09d**.
- Função pretendida: **agexaConversionFeed**; publicação não verificada.
- Endpoint: não fornecido nem deduzido do domínio/App ID.
- Segredo na Base44: configurado segundo o CEO; não inspecionado.
- Mesma chave no Office: ausente nesta execução; autenticação pendente.
- Plano/Backend Functions/RLS: não verificados no editor real.
- Oferta: **inativa** até prova das regras reais; referência automática desativada.

Seguir o [guia de implantação, chave e aceitação](AGEXA_BASE44_DEPLOY.md).
O [relatório da implementação](AGEXA_BASE44_REPORT.md) distingue testes locais
isolados de verificações que exigem acesso à Base44.

## Componentes reutilizados

O mesmo `AgexaBase44Connector` consulta o feed HMAC por pedido explícito do CEO.
O Conversion Engine existente mantém ledger, deduplicação, referências, associação
manual auditada, Free Trial Tracker, CRM, métricas por origem, avisos persistentes
ao CEO e análise Orion só de leitura. Não há segundo CRM, motor ou SQLite.

Factos sem atribuição inequívoca ficam pendentes. Abertura/envio de links não cria
cadastro, teste ou pagamento. Após entrega confirmada do convite, a conversa
continua com o CEO; os agentes não retomam respostas por iniciativa própria.
A alternativa manual continua identificada como manual, sem certificar a API.

## Artefactos

- `integrations/base44/agexaConversionFeed.ts`: entrada Deno/backend.
- `feedHandler.ts`: HMAC, limites, escopo e validação antes do acesso privilegiado.
- `feedReader.ts`: paginação compatível com o SDK e reinício de percursos finitos.
- `publishConversionEvent.ts`: helper **interno**, a ligar aos factos confirmados do domínio.
- `OfficeConversionEvent.schema.json`: contrato portável, não configuração RLS nativa.
- `deploy/agexaConversionFeed.ts`: ficheiro único para colar no editor.
- `deploy/publishConversionEvent.ts`: módulo único para os hooks backend internos.
- `core/src/conversionContract.ts`: validação partilhada entre Office e função.

`npm run base44:bundle` gera os dois módulos sem rede; `npm run base44:check`
verifica correspondência com as fontes. Esbuild não substitui compilação Deno,
permissões ou teste no runtime Base44. Não se instalou SDK no Office.

## Compatibilidade e rede

Inspecionou-se o pacote oficial `@base44/sdk` **0.8.57** fora do checkout, além do
[README oficial](https://github.com/base44/javascript-sdk/tree/main/packages/sdk).
A API de opções devolve `items`/`next_cursor`; continuar um cursor não permite
repetir sort/fields. Os artefactos usam essa API e não o overload legado em array.
Não se certifica que esta versão coincida com o runtime/SDK instalado na app real.

Service role existe apenas nas funções alojadas autorizadas. O Office não recebe
credencial administrativa Base44 nem utiliza service role externamente. O wrapper
só cria esse cliente e consulta a entidade depois da verificação HMAC.

Esta rede recusou o site e `docs.base44.com` com CONNECT 403. Isso não demonstra
indisponibilidade global da aplicação. O transporte externo existente recusa
proxies sem garantia de DNS fixado; não remove proxy, não desativa TLS nem SSRF.
A política/proxy atual também é um bloqueio a resolver por transporte/hospedagem
autorizados antes da validação real, mesmo depois de configurar chave e endpoint.
