# Validação independente — IA real e WhatsApp supervisionado

## Evidência desta instância

- Ollama não foi encontrado no PATH. `127.0.0.1:11434/api/tags` não respondeu por
  serviço acessível. Nenhum modelo selecionado foi validado, nenhum foi descarregado.
- Zero tarefas executadas com um modelo real. O novo registo independente distingue
  indisponibilidade, falha de contrato e contrato aprovado; emulador fica simulado.
- Chromium instalado: **154.0.8037.57**. Executar `--version` comprova o binário,
  não sandbox funcional com WhatsApp, sessão, QR digitalizado ou autenticação.
- E2E da interface usa Chromium local com fixtures e backend temporário; não valida
  o conector WhatsApp real. O provider real conserva as proteções do navegador/TLS.
- Nenhuma conta WhatsApp autenticada, nenhuma mensagem a clientes reais e nenhuma
  sessão/QR real publicado. Conector experimental implementado, mas ligação real
  não validada.

## IA: procedimento sem downloads implícitos

1. Disponibilizar um serviço Ollama e modelo **já instalados/autorizados**. Não usar
   API paga ou descarregar modelo para tornar um teste verde sem autorização.
2. Na Central IA, verificar o serviço, modelos efetivamente devolvidos e selecionar
   o nome instalado. A configuração sozinha não comprova inferência.
3. Em **Conversões → Validação técnica**, executar a verificação independente.
   O pedido controlado Nexus não contém clientes nem ferramentas de envio.
4. Consultar a validação e a tarefa correspondente em Tarefas: modelo, duração,
   resposta persistida, modo e resultado do contrato JSON.
5. Só `mode=real` com `status=contract_pass` comprova que o adaptador recebeu e
   validou uma resposta de um serviço real configurado. Não comprova qualidade
   comercial, precisão factual ou segurança universal de qualquer texto produzido.
6. Modelos inválidos, capacidade, timeout e JSON incorreto são falhas explícitas.
   Modo manual e operações por regras continuam disponíveis.

O emulador dos testes nunca serve como prova de IA real. Não ativar flags de teste
no diretório operacional do CEO.

## WhatsApp: checklist com número secundário

Usar apenas uma máquina local/deploy de confiança, número secundário e autorização
explícita do administrador. Nunca o número principal. O cliente não oficial pode
ser restringido ou bloqueado. O modo automático permanece bloqueado.

Registar cada etapa separadamente, com hora e evidência privada, sem publicar QR,
token, cookies, sessão ou conversas. Não assinalar uma etapa com base na anterior.

| Etapa | Evidência necessária | Estado nesta execução |
| --- | --- | --- |
| Chromium funcional | Versão e arranque real com sandbox no ambiente autorizado | Só versão e testes da interface; conector não validado |
| Sessão iniciada | Inicialização LocalAuth/browser sem erro | Não realizado com conta real |
| QR apresentado | Evento QR atual no painel privado | Testado apenas com cliente injetado |
| QR digitalizado | Ação no telefone secundário | Não realizado |
| Conta autenticada | Evento de autenticação real | Não realizado |
| Provider ligado | Ready real e identificação quando disponível | Não realizado |
| Mensagem recebida | Mensagem enviada por participante de teste autorizado | Mock apenas |
| Resposta aprovada | Versão exata aprovada individualmente pelo CEO | Testado com fixtures |
| Aceitação do envio | Confirmação suficiente do provider; não mera existência de ID | Mock/cliente injetado apenas |
| Desconexão | Browser fechado, estado desconectado | Contrato testado, conta real não validada |
| Reconexão | LocalAuth retido, novo ready real | Contrato testado, conta real não validada |
| Revogação | Logout e remoção local; verificar dispositivos no telefone | Contrato testado, conta real não validada |

Executar os passos de [AGEXA_MESSAGING.md](AGEXA_MESSAGING.md). Se a rede impedir
acesso, não remover proxy nem desativar TLS/sandbox. Parar a validação e usar uma
máquina/rede autorizada. O botão “preparação técnica” só reporta observações atuais;
não promove um binário existente ou um Mock a conta autenticada.

Em qualquer falha ambígua de envio, reconciliar manualmente e não repetir cegamente.
Após convite confirmado, verificar atribuição CEO, bloqueio dos agentes, notificação
persistente e ausência de novos envios por iniciativa dos agentes. Depois de revogar,
confirmar a remoção também nos Dispositivos associados do telefone.
