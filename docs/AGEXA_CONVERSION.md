# AGEXA Conversion Engine — Fase 6

O Office acompanha factos confirmados, não presume conversões a partir de atividade.
O percurso manual é funcional sem Base44, Ollama ou WhatsApp real. O conector
Base44 e a função de leitura estão implementados por contrato, mas **a integração
real com a aplicação não foi autenticada nem validada**.

## Utilização

Iniciar o standalone como documentado em [AGEXA.md](AGEXA.md), entrar na área privada
e abrir **Conversões**. O escritório, editor, funcionários, CRM e inbox continuam
nos mesmos módulos. Não há contacto automático depois de uma transferência ao CEO.

O CEO indicou `https://agexa-flix.base44.app`. Este endereço é uma referência da
aplicação, não permite deduzir o ID interno, plano, endpoint de função ou regras
reais do teste. O URL de entrada/cadastro é guardado na base comercial existente;
a oferta de sete dias só deve ser ativada pelo CEO quando estiver efetivamente ativa.
Não se criou um segundo conjunto de configurações para URL/oferta/duração.

Em **Integração Base44**, a secção de conhecimento reutiliza os campos existentes:
URL HTTPS, confirmação da oferta de sete dias, funcionalidades, preços e políticas.
Guardar o URL não confirma conta, início de teste ou pagamento.

## Confirmar um cadastro ou pagamento manualmente

1. Abrir **Confirmações e eventos**, ou o botão correspondente num acompanhamento CEO.
2. Selecionar a empresa por ID, sem associação por semelhança de nomes.
3. Introduzir o ID opaco da conta no sistema, tipo de facto, data efetiva e evidência.
   Não usar nome, telefone ou email como identificador técnico.
4. Para teste, indicar início e término fornecidos pelo sistema real. Não são
   preenchidos a partir do envio do convite.
5. Para pagamento, indicar recibo, montante inteiro em unidades mínimas da moeda
   (por exemplo, 1000 = 10,00 MZN), moeda ISO e confirmação independente.
6. Confirmar a declaração e guardar. O evento aparece como manual; empresas de
   simulação permanecem simuladas mesmo quando se utiliza este formulário.

O ID do evento é conservado na tentativa para permitir retries idempotentes.
Repetir o mesmo ID/conteúdo não cria outro cadastro; ID repetido com conteúdo
alterado é recusado. Um recibo não gera receita duplicada, inclusive depois de
associação auditada de um alias da conta. Moedas não são somadas entre si.
Pagamento zero, sem recibo ou sem confirmação independente não cria cliente pagante.

Eventos antes de existir cadastro ficam pendentes. Quando chega a conta correta,
o motor reprocessa os pendentes limitados por passagem. Não se perdem as evidências.
Uma referência desconhecida ou conta em conflito exige associação auditada pelo CEO.
Aliases externos só se ligam a uma conta existente após confirmação explícita;
não substituem IDs antigos nem movem a conta de outra empresa. Eventos incorretos
pendentes podem ser rejeitados com motivo, conservando o histórico.

## Referências comerciais e convites

Cada convite guarda oportunidade, conversa, versão, funcionário, preparação,
confirmação, URL utilizada, referência UUID e origem da confirmação. O UUID não
contém contacto, dados pessoais ou segredo de sessão.

Por omissão, o link oficial não é alterado. Só ativar “o cadastro captura a referência”
quando essa capacidade tiver sido implementada e confirmada na aplicação Agexa,
com ID interno e evidência. Então o backend acrescenta o parâmetro configurado
(padrão `agexa_ref`) e regista o URL exato autorizado. O modelo não inventa referências.
URLs de outra conversa, referências forjadas e URLs não aprovados são recusados.

O cadastro é atribuído automaticamente apenas por referência exata registada ou
conta externa já associada. A associação manual continua identificada separadamente
da origem do facto: um facto assinado pode ter associação confirmada pelo CEO.
Não se deduz cadastro por nome, clique, interesse, aprovação ou envio do link.
Não existe rastreio de abertura de links nesta fase.

## Free Trial Tracker

Mostra contas confirmadas, datas informadas, dias restantes, estado e origem do
último facto de teste. A origem do pagamento fica no respetivo recibo/relatório.
A duração comercial continua sete dias; datas reais e extensões podem diferir e
são apresentadas como recebidas, sem inventar um intervalo a partir da conversa.

Estados: ativo, expirado confirmado, cancelado ou convertido. Se o prazo informado
passar sem evento de término, mostra **fim previsto atingido; aguarda confirmação**.
Não transforma o relógio local numa confirmação automática de expiração.
Eventos antigos não regridem um estado mais recente e o pagamento confirmado não
é revertido por um evento tardio de teste. O histórico de todos os factos mantém-se.

Alertas próximos do fim são notificações internas persistentes e idempotentes.
Não enviam lembretes por WhatsApp. O botão de alertas recalcula a proximidade pelas
datas conhecidas; não simula atividade dos agentes. Confirmações antigas do CRM
sem datas/valor continuam separadas, sem inventar datas ou receita para preencher
os novos indicadores.

## Acompanhamento CEO

Reutiliza a transferência e o bloqueio da Fase 5, na mesma transação do envio
confirmado. Não foi criado um segundo mecanismo de envio ou atendimento automático.
A notificação persistente **NOVO CLIENTE INTERESSADO — ATENDIMENTO DO CEO** abre
empresa e conversa, e resiste a reinícios.

O resumo contém empresa/setor, necessidades registadas, última mensagem recebida,
URL/hora efetivamente confirmados, preparador, argumentos realmente enviados,
objeções explicitamente classificadas a partir de mensagens recebidas, próxima
ação e estado do cadastro. Roteiros de objeções ainda não enviados não são falas
reais do cliente.

O CEO pode guardar notas e data de acompanhamento interno, confirmar factos, abrir
a inbox/CRM, abrir WhatsApp pelo mecanismo existente e encerrar com motivo.
Cliente já pagante não pode ser encerrado como não convertido. Para devolver aos
agentes é necessária a ação explícita já existente na inbox. Confirmar cadastro,
teste ou recibo não altera essa responsabilidade nem dispara mensagens.

## Relatórios e origem

O funil real usa empresas distintas. Cada rácio é a interseção das empresas
conhecidas em duas etapas adjacentes, dividida pelas empresas da etapa anterior.
Sem denominador é indisponível. Não mede causalidade, coorte temporal ou abertura
de links. Casos registados diretamente sem etapa anterior não inventam essa etapa.

Contas, testes, pagantes e receita são separados em: feed autenticado, declaração
manual e simulação. A fonte é a confirmação registada, não uma garantia de cobertura
total da aplicação. Receita permanece indisponível sem recibos; totais por moeda
são separados. Recibos observados novamente por outra origem não duplicam valor.
As métricas por funcionário usam o preparador do primeiro convite registado, como
atribuição operacional, não prova causal de uma venda. Métricas por setor usam o
setor efetivamente guardado no CRM.

Nexus, Sophia e Orion podem executar revisão interna por regras ou IA explicitamente
selecionada. Só leem métricas. O resultado do modelo não cria cadastro, teste,
pagamento, permissões ou envio de mensagens.

## Persistência e segurança

Migração aditiva v4 → v5, preservando as entidades e IDs existentes. Novas tabelas:
configuração/sincronização, referências/convites, factos, contas/aliases, testes,
recibos, acompanhamentos, notificações, objeções observadas, auditoria e validações.
As ligações ao CRM/messaging usam IDs existentes, sem duplicar empresas/conversas.

Factos e recibos têm chaves únicas. Lotes de sincronização são transacionais;
uma falha não avança o cursor nem aplica parcialmente um lote inválido.
Uma sincronização interrompida fica assinalada e não é repetida automaticamente.
O cursor é opaco; páginas finais sem novo cursor conservam o ponto anterior,
permitindo releitura idempotente da última página enquanto surgem eventos novos.
Máximo 100 eventos/pedido, 256 KiB, timeout de 10 s e 30 tentativas/hora.
Pendentes são reavaliados em passagens limitadas; a página permite resolução manual.

Endpoints são privados, com token/Host/Origin existentes. Não há webhook público.
Payloads têm campos limitados e datas validadas; dados externos não têm autoridade
para alterar políticas. Segredos de integração só entram no processo backend,
nunca na configuração enviada ao frontend ou em ficheiros Git.

Retenção configurável de 30 a 3650 dias redige payloads antigos de factos aplicados,
conservando IDs, hashes, projeções e recibos para impedir reprocessamento. Não apaga
mensagens, consentimentos ou histórico operacional anterior. Cópias de segurança
continuam privadas; o operador deve aplicar a sua política de retenção às cópias.

Consultar [Base44](AGEXA_BASE44.md) e [validação real IA/WhatsApp](AGEXA_VALIDATION.md).

As listas do snapshot mostram até 200 contas/testes e 100 convites/acompanhamentos;
os eventos têm páginas de 50. Os agregados usam todos os registos. Alertas próximos
do fim são criados em lotes de até 200 ainda não notificados; repetir o botão processa
o lote seguinte sem duplicar os anteriores. No telemóvel, as tabelas largas permitem
deslocamento horizontal.
