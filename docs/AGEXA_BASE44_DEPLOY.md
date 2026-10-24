# Implantar a integração na aplicação Agexa existente

Aplicação confirmada: `https://agexa-flix.base44.app/`.
App ID: **6970e6a789a360f2b09ea09d**. Este ID não revela o URL da função.
Não existe acesso autenticado ao editor Base44 nesta sessão; os passos seguintes
são o handoff ao proprietário, não operações já executadas na aplicação.

## 1. Verificar capacidade e preservar clientes

No editor da aplicação correta, verificar plano/permissões de **Backend Functions**,
criação de entidades privadas e acesso ao código. Não aceitar upgrade pago.
Se o plano não permitir, manter a confirmação manual auditada no Office; não tornar
entidades públicas para contornar essa limitação. Os nomes exatos dos menus podem
variar: não foram observados no editor desta conta.

Identificar o código já existente de cadastro, entitlement/teste, expiração,
cancelamento e confirmação do processador de pagamento. Preservar entidades,
clientes e regras atuais. Não criar lógica paralela de teste/pagamento neste feed.

## 2. Entidade e permissões efetivas

Criar **OfficeConversionEvent** com:

- `event_key`: texto SHA-256 de `[appId,eventId]`, calculado pelo backend.
- `payload`: objeto do contrato em `integrations/base44/OfficeConversionEvent.schema.json`.
- Ordenação pelo `created_date` nativo. Registos append-only; não editar factos antigos.

O schema fornecido é JSON Schema portável, **não é uma configuração nativa de RLS
certificada para importação**. Adaptar ao editor real, sem supor que ocultar a
entidade dá privacidade. Configurar regras de dados que recusem a visitantes e
a todos os utilizadores comuns **list/read/create/update/delete**, incluindo os
seus próprios eventos. Somente código backend de confiança usa service role.
Não conceder privilégio via campo de perfil editável pelo utilizador.

Verificar em sessão comum e anónima que a API recusa leitura e todas as mutações.
Esse teste não pode ser substituído pelos testes HTTP do Office: são fronteiras
de segurança diferentes. Conservar evidência privada sem tokens ou dados pessoais.
Se houver restrição única real suportada, aplicá-la a `event_key`; não inventar
sintaxe de índice/permissão não verificada.

## 3. Função de leitura pronta para colar

1. No editor de código/backend, criar uma função chamada **agexaConversionFeed**.
2. Colar **todo** `integrations/base44/deploy/agexaConversionFeed.ts`. É um ficheiro
   único, sem imports relativos. Mantém `npm:@base44/sdk@0.8.57` como import externo.
   As fontes separadas servem para manutenção; não colar só o wrapper que depende delas.
3. Manter os segredos já criados na Base44: `AGEXA_BASE44_APP_ID` com o ID acima e
   `AGEXA_BASE44_EVENT_SECRET` com a chave existente, de pelo menos 32 caracteres.
   **Não gerar uma segunda chave nem a colocar no código.**
4. Compilar/verificar no runtime Deno/Base44 e confirmar suporte WebCrypto, SDK,
   entidade e paginação. A geração esbuild local não executou essa validação externa.
5. Confirmar como a plataforma autentica a invocação antes de entrar no handler.
   O contrato usa HMAC próprio; se houver uma barreira adicional, obter uma rota
   backend/gateway autorizada compatível. Não desproteger entidades nem exportar
   service role para o Office. A função tem de recusar pedidos HMAC inválidos.
6. Publicar a função pelas ações disponíveis no editor autorizado, sem upgrade.
   Copiar o URL HTTPS indicado nos detalhes/invocação da função publicada.
   Se a interface não mostrar URL direto compatível, consultar a configuração
   autorizada/documentação da conta. **Não deduzir `/functions/...` pelo domínio.**

## 4. Mesma chave no backend Office

O Office calcula HMAC localmente: necessita da **chave bruta**, igual à Base44.
Um binding de proxy que substitui headers não entrega esse material e não é
configuração funcional de HMAC. A ferramenta de segredos desta sessão oferece
bindings de proxy; não se declarou um binding fictício nem se recebeu a chave.

Provisionar pelo gestor seguro do host backend, fora do chat/Git/browser:

- **Uma** fonte: variável bruta `AGEXA_BASE44_EVENT_SECRET` entregue ao processo
  pelo gestor do host; **ou** montagem de ficheiro privado com caminho absoluto
  indicado por `AGEXA_BASE44_EVENT_SECRET_FILE`.
- Para ficheiro: diretório privado; ficheiro regular, sem symlink, propriedade do
  utilizador que executa Node, modo `0600` ou mais restrito. Entre 32 caracteres e
  4096 bytes UTF-8. Conteúdo exato, **sem newline final, CR, LF ou NUL**. Não se
  faz trim nem se altera a chave; não usar `echo` que acrescente newline.
- Se ambas as fontes estiverem preenchidas, o Office recusa a configuração ambígua.
  Chave curta, ilegível ou ficheiro inseguro aparecem como configuração inválida.
- Não colocar a chave em `.env` versionado, SQLite, formulário administrativo,
  argumento de shell, logs, screenshot, URL, variável `VITE_*` ou mensagem de chat.
- Reiniciar o backend com a fonte montada/disponível. Não instalar nada no Chromebook.
  Verificar apenas o indicador **HMAC disponível no backend** em Conversões.
  Presença/comprimento não provam igualdade: só uma resposta real autenticada prova.

O rascunho do ambiente pode guardar o **caminho não secreto** sugerido
`/run/secrets/agexa_base44_event_secret`; não cria ficheiro, chave ou mount. A montagem deve ocorrer em runtime, fora do
snapshot/backups do projeto.
Se o host não disponibilizar chave bruta/montagem segura, o administrador tem de
configurar um backend confiável com essa capacidade. Não fornecer o segredo ao chat.

## 5. Publicação interna dos factos reais

Adicionar `deploy/publishConversionEvent.ts` como **módulo backend interno**, não
como função HTTP pública. O ficheiro exporta helpers e não chama `Deno.serve`.
Se o editor não aceitar módulos internos, incorporar os helpers no módulo backend
já responsável pelo domínio; não criar um endpoint que aceite factos do browser.

Importar/chamar `publishConversionEvent(entity, appId, confirmedDomainFact)` com
`entity = base44.asServiceRole.entities.OfficeConversionEvent` **apenas dentro do
backend confiável**, depois de confirmar a operação real. Não chamar a partir de
um pedido de escrita arbitrário do cliente ou ferramenta do modelo.

| Evento | Prova e dados necessários |
| --- | --- |
| `account_created` | Conta realmente persistida; ID opaco estável |
| `trial_started` | Entitlement real ativo; `startAt` e `endAt` efetivos |
| `trial_extended` | Extensão já aplicada; novas datas efetivas |
| `trial_ended` | Expiração efetivamente confirmada pelas regras do domínio |
| `trial_cancelled` | Cancelamento efetivo confirmado |
| `payment_confirmed` | Liquidação confirmada pelo processador/backend; recibo estável `paymentId`, `verified:true`, `amountMinor` inteiro positivo e `currency` ISO maiúscula |

Campos comuns: `eventId`, `appId`, `kind`, `occurredAt` ISO, `accountId`, `evidence`
com identificador opaco da confirmação. Sem nomes, telefones, email, cartões ou
segredos. `reference` é opcional; não se fabrica uma quando desconhecida.
A validação de campos não consegue provar que uma evidência textual é verdadeira;
essa responsabilidade é do domínio autorizado. `verified:true` do browser não vale.

IDs dos factos têm de ser permanentes; retries usam o mesmo ID. O helper calcula
`event_key`, procura cópias anteriores e recusa payload alterado no mesmo ID.
**Consulta seguida de create não é unicidade atómica na Base44.** Usar a restrição
única/outbox/transação que o domínio real suportar. Não se afirma exatamente uma
inserção em chamadas concorrentes. O Office deduplica também cópias concorrentes
pelo par app/evento e recibo, sem duplicar receita ou avisos.

Ligar ao outbox/retry existente, ou preparar um outbox do domínio com retry do mesmo
facto após falha. Não falhar um cadastro já confirmado só por falha de publicação,
nem o perder silenciosamente. Sem acesso ao código da aplicação não foi possível
implementar a transação/outbox nem assegurar entrega automática de factos reais.

## 6. Captura de `agexa_ref`

O Office já gera UUID comercial quando a capacidade é confirmada. No cadastro real,
validar com `captureCommercialReference`, conservar o UUID associado à conta e
incluí-lo no evento de cadastro. O retorno é só um candidato sintaticamente válido;
não comprova que exista no Office. A associação final usa correspondência exata.

Persistir a primeira atribuição confirmada da conta, sem sobrescrever por outro
link; retries devem reutilizar conta, referência e ID de evento. Usar a relação
única do domínio para impedir múltiplas associações. Referência não identifica o
cliente, não autentica e não altera preços, permissões ou duração do teste.
Valores inválidos são ignorados para atribuição, sem impedir o cadastro legítimo.

Não se inspecionou nem ativou esta captura na app real. Manter a opção desativada
no Office até teste ponta a ponta. A associação manual auditada permanece disponível
para eventos sem referência, conflitos e aliases, sem inferir pelo nome/telefone.

## 7. Sincronização e recuperação

No painel privado: **Conversões → Integração Base44**. App ID confirmado acima,
endpoint real publicado, HMAC-SHA256, evidência das permissões verificadas e modo
**Feed assinado a pedido do CEO**. Guardar antes de sincronizar. Sem campo de chave.
Não ativar captura comercial só por ter guardado o ID.

Pedido e resposta usam HMAC-SHA256 hexadecimal de
`timestamp + "\n" + nonce + "\n" + corpo_JSON_exato`. Timestamp em milissegundos UTC,
janela de cinco minutos, nonce UUID novo e repetido na resposta; limites e escopo
verificados antes de efeitos comerciais. A origem é read-only, sem mutações de
conta/teste/pagamento. Repetir a leitura não cria conversões.

Cada pedido lê até 100 eventos. A página inicial usa `sort: created_date` e
`fields: payload`; continuação usa **só cursor e limit**, como o SDK 0.8.57 exige.
O cursor Office é um envelope versionado com escopo da app. No fim de um percurso
finito guarda um token de reinício; a consulta seguinte começa outro percurso para
apanhar inserções posteriores. Sobreposição é deduplicada no ledger existente.
É uma varredura cíclica, sem promessa de custo constante em bases grandes.
Até 30 pedidos/hora, incluindo falhas. Não se criou cron nem polling oculto.

Cursor e aplicação do lote são persistidos numa transação. Falhas não avançam o
cursor nem deixam parte do lote aplicada. Reinício mantém cursor/histórico; pedido
interrompido não reinicia sozinho. Cursor SDK expirado/incompatível produz erro;
rever e guardar a configuração reinicia o percurso com auditoria e deduplicação,
sem apagar o ledger. Não tentar converter manualmente um cursor antigo arbitrário.

Nesta nuvem o proxy não garante a fixação DNS exigida pelo transporte. Obter
hospedagem/transporte autorizados que cumpram proxy, TLS e SSRF antes do teste real.
Não apagar variáveis de proxy nem desativar verificações para fazer o teste passar.

## 8. Sete dias: proposta e condição de ativação

Manter oferta inativa. No projeto real verificar primeiro se já existe: início,
fim persistido, funcionalidades, expiração, cancelamento e passagem a pago. Reutilizar
as regras existentes. Uma duração de sete dias mostrada num fixture não é evidência.

Se não existir, proposta para revisão do CEO: entitlement explícito de sete dias,
data de início/fim persistida pelo domínio, permissões e expiração aplicadas no
backend, sem alterar clientes atuais ou cobrar automaticamente. A decisão de início
(cadastro ou ativação) e funcionalidades pertence ao produto real. Só implementar/
ativar depois de confirmação do CEO e testes autorizados; não se ligou a promoção.

## 9. Aceitação externa pendente

Num ambiente de teste autorizado, separado dos clientes:

1. Provar negação RLS anónima/comum e recusa HMAC ausente/errada, app errada,
   nonce inválido e timestamp antigo, antes de qualquer consulta privilegiada.
2. Fazer um cadastro autorizado; confirmar evento, referência exata ou pendência,
   CRM/ledger, aviso CEO e Orion. Repetir consulta e reiniciar sem duplicar.
3. Confirmar datas/regras reais do teste, extensão, fim e cancelamento; fora de ordem
   não pode fazer cliente pagante regredir. Não inferir expiração apenas pelo relógio.
4. Validar pagamentos exclusivamente em sandbox oficial separado e identificado
   como teste. Não alimentar receita real do Office com recibos de sandbox. Cobrança
   pendente/checkout não é confirmação. Não usar credenciais inventadas.
5. Provar página seguinte, evento inserido após fim do percurso, erro HTTP/rede e
   recuperação. Confirmar que não há perda nem duplicação de recibos/avisos.
6. Conservar handoff CEO e bloqueio de resposta dos agentes após convite confirmado.
7. Guardar evidências sem segredo/PII. Só depois declarar a integração autenticada e,
   separadamente, registar prova para ativar a oferta. Não ligar WhatsApp principal.
