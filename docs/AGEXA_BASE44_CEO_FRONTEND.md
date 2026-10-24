# Implementar o painel privado na Base44

**Backend e artefactos preparados; esta página/função não foi publicada na Base44.**
A Base44 apresenta dados e autentica o CEO. Todo o trabalho dos oito funcionários
continua no Office Node.js remoto persistente. Não criar agentes, CRM ou filas locais.
O Chromebook só precisa do navegador; não instalar Ollama/Node/modelos nele.

## Preparação no editor autorizado

1. Na aplicação `https://agexa-flix.base44.app/`, App ID
   `6970e6a789a360f2b09ea09d`, verificar suporte a Backend Functions e quotas do plano.
   Não fazer upgrade pago. Sem essa capacidade, não colocar uma chave no browser
   para contornar; manter o Office privado existente até haver intermediário seguro.
2. Configurar a aplicação/página do CEO como privada. Confirmar login e políticas
   de sessão/MFA disponíveis. Obter o **User ID imutável do CEO** na conta real
   (utilizadores/administração ou `auth.me()` em contexto autenticado próprio).
   O App ID acima **não é** o ID do CEO. Não confiar num campo role editável.
3. Configurar na função backend:

   | Nome | Valor a configurar por canal seguro |
   | --- | --- |
   | `AGEXA_OFFICE_API_ORIGIN` | Origem HTTPS real do host Office, sem path/query/credenciais; ainda desconhecida |
   | `AGEXA_CEO_READ_IDS` | IDs reais separados por vírgulas para consulta; sem espaços |
   | `AGEXA_CEO_CONTROL_IDS` | IDs reais que podem confirmar controlo/aprovações; sem espaços |
   | `AGEXA_CEO_BRIDGE_SECRET` | Nova chave exclusiva desta ponte, ≥32 caracteres, igual no Office |

   A chave da ponte tem finalidade diferente de `AGEXA_BASE44_EVENT_SECRET` do
   feed comercial; preservar esse segredo e a integração anterior. Gerar a nova
   chave no gestor seguro e provisionar nos dois backends, nunca no chat/Git/UI.
4. Criar função backend **agexaOfficeAdmin**. Colar todo o conteúdo de
   `integrations/base44/deploy/agexaOfficeAdmin.ts` (ficheiro único, sem imports
   relativos, SDK `npm:@base44/sdk@0.8.57`). Usa apenas `auth.me()`; não precisa
   de entidade Base44 nova ou service role para agentes/dados do Office.
5. Compilar/verificar no runtime real e publicar pela interface autorizada.
   Confirmar que a função mantém a autenticação Base44 e recusa sessões inválidas.
   A origem frontend aceite no artefacto é a aplicação confirmada acima; para
   acrescentar domínio personalizado, rever explicitamente a política e os testes.
   Os menus/endpoints de função da conta não foram inspecionados nesta sessão.
6. Copiar todo `integrations/base44/deploy/officeClient.ts` para um módulo frontend
   da app, por exemplo `lib/agexaOfficeClient.js` (o conteúdo gerado é JavaScript ESM).
   O ficheiro já inclui o catálogo/validação e não tem imports relativos externos.
   Não copiar só a fonte original com imports para `core/` sem também resolver essas
   dependências. Nunca importar `agexaOfficeAdmin` ou o protocolo de assinatura no browser.
7. Reutilizar a instância **real já existente** do cliente Base44 da app. Adaptar o
   caminho de importação ao projeto real; ele não foi inventado nesta entrega.

```js
import { createOfficeClient } from './lib/agexaOfficeClient.js';
// base44 é a instância autenticada existente da aplicação.
const office = createOfficeClient((name, payload) =>
  base44.functions.invoke(name, payload)
);
```

Este cliente não recebe URL Office, token administrativo, segredo ou actorId.
O SDK encaminha a sessão do utilizador à função; o backend verifica-a em cada pedido.

## Consultar dados verdadeiros e atualizações

```js
const state = await office.read('office.state');
// Renderizar state.employees, incluindo name/role/area/status/currentTask/indicadores.
// Não definir uma lista paralela de funcionários ou estados de atividade no frontend.
const blocked = await office.read('tasks.list', {
  query: { status: 'blocked', page: 1 }
});
const companies = await office.read('crm.companies', {query:{page:1}});
const conversions = await office.read('conversion.overview');
const orion = await office.read('reports.orion', {query:{page:1}});
const integrations = await office.read('integrations.state');
const nexus = await office.read('nexus.workflows');
```

Consulta periódica segura (exemplo React dentro de `useEffect`):

```js
const stop = office.watch(
  state => setOfficeState(state),
  () => setConnectionError('Office indisponível; dados anteriores podem estar desatualizados')
);
return stop; // desmontagem/logout: encerra o agendamento e ignora resposta pendente
```

Um watcher por painel. A cada 5 s enquanto visível; sem sobreposição; página oculta
não consulta; erros recuam para 30 s. Mostrar hora da última resposta e estado de
ligação. Uma falha não deve tornar funcionários "ativos" nem limpar histórico como
se fosse zero real. Usar também atualização manual para reduzir chamadas conforme
as quotas da conta. O modo leve pode usar cartões; o escritório/editor original
continua preservado no projeto, sem depender desta página estar aberta.

O formato de todas as operações está em [AGEXA_CEO_API.md](AGEXA_CEO_API.md) e no
OpenAPI gerado. Não reutilizar transportes antigos que exigem o token permanente
no browser. Não abrir `/ws?token=...`, terminal ou SQLite através do painel Base44.

## Botões de controlo com confirmação e ID persistido da ação

Exemplo após o CEO rever a ordem e confirmar a autorização dos dados:

```js
if (!authorizedDataCheckbox.checked) throw Error('Confirmar origem/autorização dos dados');
if (!window.confirm('Pedir este plano ao Nexus? A distribuição terá aprovação própria.')) return;
const pendingCommand = {
  operation: 'nexus.command',
  requestId: crypto.randomUUID(), // conservar na memória do componente para diagnóstico/repetição segura
  confirm: true,
  input: {body:{goal: goalText, input:{authorized:true, brief: briefText}}}
};
try {
  const workflow = await office.request(pendingCommand);
  showWorkflow(workflow); // mostrar estado verdadeiro, incluindo erro/bloqueio sem IA
} catch {
  showError('Verificar tarefa/auditoria antes de repetir. ID: '+pendingCommand.requestId);
}
```

Não executar retries automáticos de escrita. Uma resposta perdida pode corresponder
a uma ação já feita. Se for preciso recuperar o mesmo resultado, conservar ID e
conteúdo; a função gera nonce novo. Em 409/502 rever estado/auditoria antes de nova ação.
Não guardar resultados privados, tokens ou segredos em localStorage. Memória React
é suficiente para navegação; o histórico verdadeiro vive no backend.

Outros exemplos, sempre após confirmação humana própria:

```js
await office.request({operation:'task.approve', requestId:crypto.randomUUID(),
  confirm:true, input:{params:{id:task.id}}});
await office.request({operation:'workflow.approve', requestId:crypto.randomUUID(),
  confirm:true, input:{params:{id:workflow.id}}});
await office.request({operation:'employee.set', requestId:crypto.randomUUID(),
  confirm:true, input:{params:{id:employee.id},body:{enabled:false}}});
await office.request({operation:'operations.stop', requestId:crypto.randomUUID(),
  confirm:true, input:{}});
```

Só apresentar botões compatíveis com a função do utilizador; o backend verifica
permissões mesmo que alguém manipule o browser. Aprovar plano só quando estiver
`proposed`; aprovar tarefa só quando a máquina de estados permitir. Não adicionar
aprovação automática por carregamento de página. Revisão de rascunho não é prova de
envio, cadastro ou pagamento. Handoff CEO e consentimento continuam obrigatórios.

## Aceitação no serviço real, ainda pendente

- Sessão comum/anónima/expirada: acesso recusado; nenhum pedido Office executado.
- CEO leitura: ver oito funcionários reais e consultas; controlo recusado.
- CEO controlo: ordem interna autorizada, aprovação elegível e suspensão reais;
  repetir o ID não duplica; erros e bloqueios visíveis.
- Confirmar quotas, origem, TLS público, relógios, secret store e permissões.
- Verificar que DevTools/storage/pedidos ao browser nunca contêm chave da ponte
  ou token permanente do Office. SDK usa apenas a sessão gerida do utilizador.
- Sem IA/WhatsApp/feed ligados, apresentar esses estados como pendentes. Não enviar
  mensagens reais para demonstrar que um botão funciona.

Nesta entrega, autenticação Base44 foi injetada nos testes. O teste local Chromium
usa uma sessão fictícia HttpOnly e HTTPS backend com CA de teste verificada;
**não comprova login, cookies, publicação ou plano da Base44 real**.
