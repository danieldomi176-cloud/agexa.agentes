# Integração Base44 — relatório de entrega

## A. Implementado

Mantidas as Fases 1–7, oito funcionários, escritório/editor, IA na nuvem e modo
leve para ChromeOS 2 GB. Nova branch a partir da última entrega efetiva, sem reset
ou force-push. Backup SQLite consistente privado antes das alterações.

Reutilizados o conector, Conversion Engine, ledger, CRM, Free Trial Tracker,
referências, notificações CEO, métricas por origem e Orion só de leitura.
Não há segundo motor, base de dados ou agendador de sincronização.

- Contrato de eventos partilhado pelo Office e função; validações antes de assinar.
- Paginação SDK 0.8.57 corrigida: continuação sem sort/fields. Token de reinício no
  fim do percurso para voltar a procurar eventos posteriores, com deduplicação.
- Helper interno de publicação de factos confirmados, IDs estáveis, deteção de
  conflito e validação de UUID comercial. Não é endpoint de escrita para browsers.
- Dois módulos únicos gerados para o editor; fontes e verificação de correspondência.
- Leitura de chave bruta por variável de runtime ou ficheiro montado privado.
  Verifica comprimento, tamanho, permissões e fonte ambígua; não faz trim.
- Prontidão administrativa explícita: chave, endpoint, captura e autenticação
  separados; sincronização indisponível sem requisitos guardados.
- App ID confirmado guardado pela API administrativa na configuração operacional,
  mantendo endpoint vazio, modo manual e captura desativada.
- Handoff CEO e bloqueio de resposta dos funcionários preservados.

## B. Testado

**1.154 testes aprovados**: 196 interface, 951 servidor, 7 contratos de pacote.
Todos os 1.135 anteriores foram mantidos; 19 novos. Um fixture de lote malicioso
agora injeta uma resposta corretamente assinada: o handler reforçado já recusaria
o payload inválido antes de chegar ao conector. Continua a testar rollback integral.

Build, tipos, lint, AsyncAPI, smoke HTTP/WebSocket e correspondência dos artefactos
aprovados. Avisos anteriores: useEffect/editor, bundle e SQLite experimental.

Oito cenários Chromium aprovados: funcionários/tarefas, inteligência, CRM,
mensagens, conversões, jornada Fase 7, cloud/modo leve e nova configuração Base44
(desktop/mobile, autenticação, gravação, reload e bloqueio sem chave/endpoint).

Testes isolados cobrem assinatura ausente/incorreta, app errada, timestamp antigo,
nonce inválido, resposta válida/adulterada, pagamentos inválidos, lote atómico,
duplicados de evento/cadastro/recibo, fora de ordem, HTTP 404/503, falha de rede,
cursor/reinício/novo percurso, notificações persistentes, isolamento simulado e
fronteira administrativa do Office. SDK/entity/transportes são fixtures injetados.
Não provam permissões reais da Base44 nem a veracidade de eventos externos.

Instalação limpa `npm ci`, lockfile preservado, build, arranque e recuperação de
backup isolado aprovados **na mesma máquina**, incluindo renderização dos oito
funcionários no Chromium com o build recém-reconstruído. Restauração numa máquina independente,
VS Code/Claude E2E e Chromebook físico não executados.

**Nenhum cadastro, teste, pagamento, inferência ou envio WhatsApp real foi executado.**
Site e documentação Base44 recusados pelo proxy CONNECT 403; não houve bypass.
Sem validação Deno/publicação, plano/RLS, autenticação ou sincronização na Base44 real.

## C. Pendente

1. No editor real, verificar Backend Functions/plano e privacidade efetiva sem
   upgrade pago. Criar/verificar entidade e compilar/publicar a função.
2. Ligar o helper aos pontos autoritativos reais de cadastro/teste/pagamento e ao
   outbox/retry do domínio. Confirmar unicidade na origem quando suportada:
   consulta + create não garante atomicidade concorrente. O Office mantém dedup.
3. Obter o URL HTTPS efetivamente publicado; não o deduzir do domínio ou App ID.
4. Provisionar **a mesma chave existente** na Base44 por gestor de runtime/montagem
   privada no host Office. Não enviar pelo chat. Proxy-secret não fornece HMAC bruto.
5. Resolver transporte/hospedagem autorizados compatíveis com DNS fixado, proxy,
   TLS e SSRF. O conector recusa o proxy atual sem essa garantia.
6. Executar a aceitação externa do guia. Só depois declarar ligação autenticada.
7. Verificar captura real de `agexa_ref` e regras dos sete dias antes de ativar
   atribuição/oferta. Associação manual auditada continua disponível.
8. Rever/guardar/publicar o rascunho do ambiente; isso não implanta a app Base44
   nem garante hospedagem permanente. IA cloud ainda depende da sua chave/conta.

Guia com passos e critérios: [AGEXA_BASE44_DEPLOY.md](AGEXA_BASE44_DEPLOY.md).

## D. Base44

| Elemento | Estado verificável |
| --- | --- |
| Aplicação | https://agexa-flix.base44.app/ |
| App ID | **6970e6a789a360f2b09ea09d**, confirmado pelo CEO e guardado no Office |
| Função | **agexaConversionFeed**: código preparado, publicação não verificada |
| Endpoint HTTPS | Desconhecido; não inventado |
| Segredo na Base44 | Configurado segundo o CEO; valor não recebido/inspecionado |
| Segredo no processo Office | Ausente; não se verificou igualdade/autenticação real |
| Sincronização operacional | Manual, sem pedidos externos; feed não autenticado |
| `agexa_ref` | Helper preparado; captura real não verificada e flag desativada |
| Sete dias gratuitos | Oferta inativa; regras reais ainda sem evidência |
| WhatsApp | Sem autenticação/número principal/envio real |

## E. GitHub e preservação

Branch: **agexa/base44-integration**, derivada de `agexa/phase-7` no commit
`41ca978fb88927e9305d60b1f3cbff8dc9cd70e1`. Os commits das sete fases continuam
ancestrais. O commit desta entrega consta do histórico da branch.

Antes/depois do arranque, hashes de **todas** as tabelas e IDs anteriores iguais,
esquema v5. Depois da gravação autorizada do App ID: só configuração de conversão,
uma linha de auditoria e a sequência SQLite dessa auditoria mudaram. Todas as
linhas comerciais anteriores, tarefas, funcionários, IA e mensagens preservadas.
Backup e base ativa passaram `integrity_check`; sem dados fictícios na base operacional.

Ficheiros de implementação/teste/documentação:

- `core/src/conversion.ts`, `core/src/conversionContract.ts`.
- `server/src/agexa/conversion/{contract,secret,service}.ts`.
- `server/__tests__/{base44Artifacts,conversionConnector}.test.ts`.
- `webview-ui/src/components/ConversionPanel.tsx`.
- `integrations/base44/{agexaConversionFeed,feedHandler,feedReader,publishConversionEvent}.ts`.
- `integrations/base44/OfficeConversionEvent.schema.json`.
- `integrations/base44/deploy/{agexaConversionFeed,publishConversionEvent}.ts`.
- `scripts/{build-base44-functions,agexa-base44-e2e}.mjs`, `package.json`.
- `docs/AGEXA.md`, `docs/AGEXA_BASE44{,_DEPLOY,_REPORT}.md`.
- `docs/screenshots/base44-setup-{desktop,mobile}.png`.

Capturas de **backend isolado**, sem conversões/chave/endpoint, não prova de ligação:
[desktop](screenshots/base44-setup-desktop.png) · [mobile](screenshots/base44-setup-mobile.png).

## Arranque e verificações

No host remoto do backend, Node 22, dependências existentes e pasta persistente:

```sh
export PATH=/workspace/.tooling/node22/node_modules/node/bin:$PATH
cd /workspace/agexa.agentes
export AGEXA_DATA_DIR=/workspace/.agexa-data
npm run start:agexa
```

O processo atual já foi reiniciado e validado. Reutilizar a pasta e o acesso privado
existentes; não criar outro processo sobre o mesmo SQLite nem expor token em links.
No Chromebook basta o navegador pela ligação privada autorizada ao host.

Para reproduzir verificações: `npm run build`, `npm test`, `npm run asyncapi:validate`,
`npm run base44:check`, `npm run test:smoke` e cenários `test:agexa:*:e2e`.
Usar `AGEXA_CHROMIUM_PATH=/usr/bin/chromium` no host desta sessão. O teste de
restauro usa só dados isolados; não substituir a pasta operacional por fixtures.
