# Chromebook ChromeOS com 2 GB — IA na nuvem

O CEO confirmou ChromeOS e **2 GB de RAM**. A configuração prioritária passa a ser
**Chrome no Chromebook → backend remoto privado do Office → Gemini Developer API**.
Não instalar Ollama, modelos, Node, Docker ou Linux no Chromebook para usar o Office.
Ollama permanece opcional numa máquina com recursos adequados; não bloqueia o uso
do fornecedor na nuvem. Os oito funcionários, CRM, inbox e editor são preservados.

## O que foi preparado e o que falta

O seletor de fornecedor, adaptador Gemini, contratos JSON, proveniência, controlo de
dados e limite diário estão implementados. Não foi feita inferência Gemini real:
não existe chave configurada e esta rede recusou acesso à API/documentação com
CONNECT HTTP 403. Testes usam transportes injetados, explicitamente simulados.

O Office requer um **backend remoto disponível**, com Node 22, SQLite em armazenamento
persistente e acesso privado autenticado. O Chromebook só executa a interface.
Esta sessão de desenvolvimento na nuvem não constitui hospedagem permanente nem
garantia de execução 24 horas. Publicar o rascunho do ambiente também não equivale
a contratar ou publicar um serviço comercial. Não foi ativada hospedagem paga.

## Opção gratuita: verificar antes na própria conta

O Gemini Developer API é o candidato prioritário por disponibilizar modalidade
gratuita para contas/modelos/regiões elegíveis. Não se garante que todos os modelos
listados sejam gratuitos ou que a disponibilidade permaneça igual. Quotas, termos,
retenção e elegibilidade devem ser confirmados **na conta real antes de gerar**.

- [Google AI Studio: chaves](https://aistudio.google.com/apikey)
- [Preços oficiais](https://ai.google.dev/gemini-api/docs/pricing)
- [Limites](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Termos](https://ai.google.dev/gemini-api/terms)
- [Regiões disponíveis](https://ai.google.dev/gemini-api/docs/available-regions)

As páginas de preços/modelos não puderam ser lidas desta rede. Não se inventaram
quotas atuais ou certificação de um modelo gratuito. O README/tipos do SDK oficial
[googleapis/js-genai](https://github.com/googleapis/js-genai) foram consultados
para o formato de mensagens/configuração JSON. O SDK não foi instalado.

Não ativar faturação, trial pago, upgrade ou cartão para seguir este guia.
Se a conta/região/modelo exigir pagamento, **parar e manter tarefas manuais/regras**.
Não há troca automática para outro serviço ou modelo pago. A confirmação humana
no Office não altera nem verifica o plano de faturação do fornecedor.

## Configurar a chave com segurança

1. No Chrome, abrir o AI Studio com a conta autorizada e confirmar nível gratuito,
   região, modelo elegível e política de utilização dos dados. No nível gratuito,
   os termos podem permitir utilização dos dados para melhorar produtos; confirmar
   as condições aplicáveis. Começar apenas com empresa/diálogo fictícios, sem PII.
2. Criar uma chave num projeto adequado, sem ativar faturação paga. Restringir a
   chave à API necessária e aplicar as restrições compatíveis com o backend.
3. Guardar **apenas no armazenamento seguro de segredos do backend** com o nome
   `AGEXA_GEMINI_API_KEY`. Não colar no chat, formulário do Office, código, Git,
   screenshots, ficheiro JavaScript ou variáveis `VITE_*`. Não colocar em URL.
4. Nesta nuvem, rever o requisito de segredo pessoal e destino
   `generativelanguage.googleapis.com` nas definições do ambiente. Guardar/publicar
   a configuração e reiniciar o backend para disponibilizar a chave ao processo.
   Um rascunho guardado sem chave/política aplicada não comprova acesso.
5. O backend envia a chave no header `x-goog-api-key`, por HTTPS, conservando
   proxy e confiança CA. Não remove proxy, desativa TLS ou segue redirects.
   Falhas de rede/credencial/quota ficam explícitas; não são contornadas.

## Configurar e testar no Office

1. Entrar no painel privado do CEO → **Central IA**.
2. Escolher **Gemini na nuvem**. O endpoint é fixo e não aceita URLs arbitrários.
3. Após verificar a conta, confirmar nível gratuito e autorização dos contextos
   enviados. A autorização aplica-se às tarefas de IA do escritório; não autoriza
   mensagens externas, pagamentos ou alteração de políticas.
4. Definir limite interno: omissão **20 tentativas de geração/dia UTC**, ajustável
   entre 1 e 100. É um teto local conservador, não a quota gratuita do Google.
5. Guardar e verificar. A lista contém até 100 modelos de geração devolvidos pela
   API e **não contém informação de preços**. Selecionar apenas um modelo cuja
   elegibilidade gratuita tenha sido confirmada na conta. Ao mudar modelo, voltar
   a confirmar o nível gratuito; não há modelo escolhido automaticamente.
6. Guardar com o modelo e confirmações atuais. Consultar a prontidão e executar
   **Verificar NEXUS**, com uma barbearia fictícia na Beira. A ordem e a inferência
   são internas. Não usar dados reais de contactos nesta primeira validação.
7. Rever tarefa: ID, hora, modelo selecionado, duração, JSON, erro e
   `executionMode=gemini`. Só uma resposta real validada prova inferência; listar
   modelos ou guardar a chave não basta. Um resultado `test` permanece simulado.
8. Rever utilidade, português e factos, depois validar os restantes funcionários.
   Para colaboração usar o plano Nexus existente, com aprovação humana e orçamento.

O contador diário fica no SQLite e sobrevive a reinícios. Tentativas iniciadas
contam mesmo se falharem. Limite interno, HTTP 429, timeout, bloqueio do fornecedor,
JSON inválido ou geração incompleta não são repetidos automaticamente. O teto
também não certifica custo zero se o operador configurar uma conta paga por erro;
por isso a conta/modelo gratuitos precisam de confirmação externa.

Sem chave ou confirmações, o backend não faz pedidos de geração. A chave nunca
é devolvida ao frontend; apenas um indicador de presença. Probes de metadados são
limitados por cache, sem geração implícita. Não há ferramentas de envio ou execução
administrativa disponíveis ao modelo. O formato JSON reutiliza as regras existentes.

## Usar menos recursos no Chromebook

O botão **Modo leve** desmonta o canvas/escritório pixel art no navegador e apresenta
os oito funcionários com estados reais do backend. A escolha é guardada localmente.
**Mostrar escritório** restaura o Pixel Agents original e o editor. Não elimina
dados nem pausa tarefas do servidor. Usar uma só aba e fechar outras aplicações.

O modo leve evita carregar/renderizar o escritório enquanto está ativo; não foi
medido consumo de RAM nem testado num Chromebook físico de 2 GB. Os testes cobrem
desktop/mobile, persistência da preferência e remoção/restauro do canvas.

O servidor administrativo continua privado. Acesso remoto precisa de HTTPS,
autenticação e Hosts autorizados; não abrir diretamente a porta administrativa
nem colocar token em links públicos. O armazenamento persistente e backups do
backend são necessários independentemente da RAM do Chromebook.

## WhatsApp, Base44 e oferta

Continuam separados da IA. WhatsApp precisa de número secundário e ambiente com
sandbox funcional; não usar o número principal. Base44 precisa de ID, endpoint,
permissões e configuração autorizada no editor. A oferta continua inativa até
prova real. Usar IA na nuvem não confirma cadastro, sete dias, recibos ou pagamentos.

Ver [relatório Fase 7](AGEXA_PHASE7_REPORT.md), [Base44](AGEXA_BASE44.md) e
[validação supervisionada](AGEXA_VALIDATION.md).
