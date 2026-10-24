# AGEXA OPERATIONAL READINESS

Atualização Chromebook: a verificação do serviço de IA acompanha o fornecedor
selecionado, incluindo Gemini na nuvem. Ollama local não é requisito do piloto
quando Gemini estiver configurado. A lista de modelos e uma chave presente não
comprovam inferência real nem nível gratuito; consultar [guia](AGEXA_CHROMEBOOK.md).

Área privada do CEO → **Prontidão operacional**. O painel reutiliza autenticação,
Ollama, fila, CRM, inbox e Conversion Engine. Não cria outro conector ou motor.

Cada componente tem `VALIDADO`, `PENDENTE` ou `ERRO`, hora da observação, evidência,
bloqueio e próxima ação. A origem distingue `technical`, `real`, `manual` e
`simulated`. Um componente local acessível não prova uma integração comercial.

Os quinze componentes são: servidor, SQLite, tarefas, Nexus, Ollama, modelo, CRM,
prospeção, inbox, WhatsApp experimental, Base44, oferta, conversões, backups e
segurança. O painel não apresenta o piloto como pronto com integrações pendentes.
Mesmo quando critérios técnicos passarem, autorização humana e os checklists
externos continuam necessários; não é certificação de produção.

- **Verificar prontidão:** consulta o serviço Ollama existente, verifica SQLite,
  permissões e dados operacionais, e guarda resumo auditado (últimas 50 passagens).
  Não instala modelos, liga WhatsApp ou sincroniza Base44 implicitamente.
- **Verificar funcionário:** cria tarefa interna no motor existente se houver
  modelo acessível e operações ativas. O resultado completo permanece em Tarefas.
  Sem modelo, regista indisponibilidade sem fingir execução.
- **Criar backup privado:** cópia consistente real, não ficheiro de demonstração.
  Valida integridade e digest; não devolve caminho nem conteúdo pelo endpoint.
- **Evidência da oferta:** declaração auditada do CEO, não verificação automática
  da Base44. Exige URL/funcionalidades guardados, cadastro e sete dias observados,
  início, comportamento no fim, necessidade de pagamento e funções incluídas.
  Só depois a API permite ativar os sete dias em Conhecimento.

A prova da oferta é ligada à configuração comercial. Mudar URL, funcionalidades,
preços ou políticas exige guardar com oferta inativa e confirmar novamente.
Evidência simulada não pode ativar oferta num processo operacional. Campos de estado
como `VALIDADO` não podem ser enviados para ultrapassar verificações.

Não há migração destrutiva: schema v5 e tabelas anteriores mantêm-se. Provas da
oferta, manifesto do último backup e histórico usam chaves `operational:*` da
tabela `settings`; ações são auditadas em `events`. Não se migram consentimentos,
conversas ou pagamentos para estruturas duplicadas.

Inferência exige resposta JSON validada pelo adaptador. A disponibilidade da API
não prova geração. Resultado `executionMode=test` nunca conta como inferência real.
A prova atual corresponde ao endpoint/modelo por digest de configuração; mudar
endpoint/modelo exige nova execução. Erros e modelos de tarefas antigas continuam
no histórico. Uma inferência correta não prova qualidade de todos os agentes.

Base44 só mostra leitura autenticada após sincronização real assinada no conector
existente. Um contrato ou sincronização simulada não basta. Mesmo leitura assinada
não comprova cadastro/trial/pagamento ponta a ponta. WhatsApp ligado só comprova
o estado atual do provider; receção/envio/reconexão/revogação exigem checklist.

Instalação e recuperação: [AGEXA_LOCAL_SETUP.md](AGEXA_LOCAL_SETUP.md).
Resultados efetivos: [AGEXA_PHASE7_REPORT.md](AGEXA_PHASE7_REPORT.md).
