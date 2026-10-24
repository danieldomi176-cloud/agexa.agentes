# Integração Base44 — contrato e implantação autorizada

**Estado: código de integração e alternativa manual implementados; aplicação real
não autenticada nem testada.** Nenhuma função foi publicada na Base44 nesta tarefa.

O CEO forneceu `https://agexa-flix.base44.app`. Não foram fornecidos ID interno,
plano, esquema de entidades, endpoint de função ou credencial. O acesso ao domínio,
a `docs.base44.com` e a `base44.com/pricing` devolveu HTTP 403 desta rede. Não houve
bypass. Não é evidência de que a aplicação esteja indisponível noutra rede.

## Evidência consultada

Foram consultados o README/código oficiais pelo GitHub e o pacote publicado
`@base44/sdk` **0.8.57**, obtido do registry npm para inspeção fora do checkout.
O SDK não foi instalado como dependência do Office. Fontes:

- [SDK oficial](https://github.com/base44/javascript-sdk/tree/main/packages/sdk).
- [README: autenticação e service role](https://github.com/base44/javascript-sdk/blob/main/packages/sdk/README.md).
- [Módulo de funções](https://github.com/base44/javascript-sdk/blob/main/packages/sdk/src/modules/functions.ts).
- [Pacote 0.8.57](https://www.npmjs.com/package/@base44/sdk/v/0.8.57).

O README declara que utilizadores externos operam com permissões de utilizador;
service role com privilégios elevados só está disponível em Backend Functions
alojadas na Base44. O Office **não usa service role externamente**, não recebe
credenciais administrativas e não assume acesso a todos os utilizadores/recibos.

A disponibilidade de Backend Functions e quotas depende do plano/permissões reais.
O preço atual não pôde ser confirmado nesta rede; verificar Billing/plano na
Base44 antes de implantar. Não foi criada subscrição nem custo obrigatório.
A alternativa manual auditada continua funcional sem serviço adicional.

## Opção A: função de leitura no backend autorizado da aplicação

Artefactos em `integrations/base44/`:

- `agexaConversionFeed.ts`: modelo Deno para implantar **dentro** da aplicação autorizada.
- `feedHandler.ts`: contrato/auth/limites, testado com WebCrypto e transporte injetado.

O wrapper usa `createClientFromRequest(req)` e só consulta
`asServiceRole.entities.OfficeConversionEvent` **depois** de verificar o pedido.
`OfficeConversionEvent` é uma entidade nova proposta para o feed, não uma entidade
que afirmamos já existir no Agexa. Deve ser privada e append-only, escrita apenas
por código backend confiável. Não permitir escrita pública ou por clientes na app.

Cada registo contém `payload` com um facto mínimo deste contrato. O código real de
cadastro/teste/pagamento do Agexa terá de publicar o facto depois de confirmar a
operação no seu próprio domínio. Esse mapeamento não foi inventado: as entidades,
regras de teste, processador de pagamentos e eventos reais da aplicação não foram
inspecionados. Não substituir por um dump de Users, dados pessoais ou interpretação
de mensagens WhatsApp.

O wrapper usa a paginação por cursor do SDK 0.8.57. Requer revisão/validação no
runtime Base44 e no esquema efetivo antes de produção. Os testes locais validam o
handler puro e o contrato; não equivalem a deploy, permissões, compilação Deno ou
leitura das entidades reais. Os cursores devem suportar leitura estável de eventos
imutáveis; verificar expiração/ordem e recuperação no teste real.

Configurar na Base44, por mecanismo seguro de segredos do backend:

- `AGEXA_BASE44_APP_ID`: ID interno confirmado pelo editor, não o slug do domínio.
- `AGEXA_BASE44_EVENT_SECRET`: chave aleatória forte, pelo menos 32 caracteres,
  partilhada apenas com o backend do Office.

No Office, fornecer o mesmo segredo ao processo backend por armazenamento seguro
apropriado; nunca pelo formulário frontend, Git ou chat. Bindings de proxy que só
substituem headers não entregam necessariamente uma chave bruta para HMAC local;
não os tratar como configuração funcional. Nesta instância não existe essa chave.

O modelo usa autenticação HMAC própria de uma função de leitura. Se a configuração
da aplicação exigir autenticação adicional antes de executar a função, resolver
isso num gateway/contrato autorizado e testar, sem tentar obter service role externo.
O endpoint HTTPS real deve ser confirmado após implantação; não é deduzido do domínio.

## Protocolo

Pedido POST, JSON UTF-8, sem segredos no corpo/URL:

```json
{"appId":"ID_CONFIRMADO","cursor":null,"limit":100,"nonce":"UUID_ALEATORIO"}
```

Headers `X-Agexa-Timestamp` (milissegundos UTC), `X-Agexa-Nonce` e
`X-Agexa-Signature`. Assinatura hexadecimal HMAC-SHA256 de:

```text
timestamp + "\n" + nonce + "\n" + corpo_JSON_exato
```

A resposta repete o nonce e o appId, inclui `events` e `nextCursor`, e é assinada
com os mesmos headers sobre o corpo exato. Comparação criptográfica, janela de
cinco minutos, limite de tamanho, escopo da aplicação e correlação do nonce são
validados antes de aplicar dados. IDs permanentes dos factos/recibos impedem replay
com efeito comercial. O endpoint de origem é read-only; repetir leitura dentro da
janela não executa operações de conta/pagamento.

Facto mínimo de cadastro (exemplo de formato, não conversão real):

```json
{
  "eventId":"ID_ESTAVEL_DO_EVENTO",
  "appId":"ID_CONFIRMADO",
  "kind":"account_created",
  "occurredAt":"2026-10-24T12:00:00.000Z",
  "accountId":"ID_OPACO_DA_CONTA",
  "reference":"UUID_COMERCIAL_SE_CAPTURADO",
  "evidence":"Identificador da confirmação no backend autorizado"
}
```

Tipos: `account_created`, `trial_started`, `trial_extended`, `trial_ended`,
`trial_cancelled`, `payment_confirmed`. Início/extensão exigem `startAt`/`endAt`
efetivos. Pagamento exige `verified=true`, `paymentId`, `amountMinor` positivo e
`currency` ISO. `verified` deve vir da lógica real do pagamento, nunca do browser,
modelo ou mera criação de checkout. Não há estado de pagamento inferido por mensagem.
Não incluir nomes, emails, telefones, tokens ou dados de cartão.

O conector Office valida URL HTTPS sem credenciais/parâmetros de autenticação,
DNS público fixado na ligação, limites e resposta assinada. Não segue redirects.
Nesta nuvem o transporte recusa o proxy sem garantia de DNS fixado; não remove
variáveis de proxy, não desativa TLS e não contorna a rede. Mesmo com ID/chave,
a sincronização real ainda exigiria transporte/rede autorizados e validação.

## Opção B: confirmação manual auditada

Disponível agora em **Conversões → Confirmações e eventos**, sem plano adicional.
O CEO associa empresa e conta com evidência, introduz datas/recibo e confirma a
declaração. A origem é manual; a API não é apresentada como validada. Quando não
houver correspondência fiável, o facto assinado também fica pendente de associação.
A associação manual não transforma a origem de um facto em automática.

Para ativar rastreio por parâmetro, o cadastro Agexa tem de capturar a referência
opaca e associá-la ao ID da conta. Desativado por omissão; não presumimos que o
Agexa atual reconhece `agexa_ref`. Sem suporte, conservar link original e usar
associação manual por evidência. Consultar [Conversion Engine](AGEXA_CONVERSION.md).
