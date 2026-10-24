# Fase 7 — relatório de prontidão operacional

Base preservada: `agexa/phase-6`, commit
`9f5f947b86d894155f5bf53dedde2b81bb49eff0`. Desenvolvimento em `agexa/phase-7`,
sem reiniciar o projeto, substituir integrações ou fazer force-push.

## Resultado e bloqueios externos

**Piloto comercial ainda bloqueado.** A infraestrutura e a jornada isolada são
testáveis; faltam provas de inferência real, WhatsApp e aplicação Base44.

| Área | Evidência efetiva | Estado externo |
| --- | --- | --- |
| Infraestrutura Office | Backend, SQLite v5, API privada, fila/eventos, CRM/inbox/conversões e escritório existentes | Componentes locais testados |
| IA real | Ollama ausente; porta 11434 recusou ligação (`ECONNREFUSED`) | Pendente instalação autorizada; zero inferências reais |
| Oito funcionários | Contratos JSON e nove tarefas colaborativas com emulador identificado; animações observadas durante tarefas reais da fila | Simulação de inferência, não validação de utilidade de modelo real |
| WhatsApp | Número secundário ainda não disponível; nenhum login/QR real. Chromium abortou com erro do helper SUID sandbox | Não ligado; preparar máquina compatível sem desligar proteções |
| Base44 | CEO tem editor; este processo não tem ID/permissões/endpoint/chave. Proxy devolveu CONNECT 403 | Não publicada/autenticada; alternativa manual mantém-se |
| Oferta | URL informado conservado; não foram verificadas regras reais do cadastro/teste | Inativa; ativação exige evidência atual do CEO |
| Instalação/recuperação | Fonte e dependências limpas, build, reinício e recuperação em diretórios temporários com fixtures | Validado nesta mesma máquina; máquina independente pendente |

O inventário é da nuvem: Debian 13 x64, quota 4 CPUs, limite 32 GiB RAM,
aproximadamente 29 GiB livres de disco, nenhum dispositivo GPU exposto.
Não descreve o computador pessoal. O CEO pediu preparação sem instalação imediata:
[passos e requisitos locais](AGEXA_LOCAL_SETUP.md). Não se descarregaram modelos,
contrataram APIs pagas, enviaram mensagens a terceiros ou alteraram a Base44.

## Implementação

Prontidão operacional apresenta quinze verificações com estado, data, origem,
evidência, bloqueio e próxima ação. Mantém histórico auditado e oferece verificação
individual dos oito funcionários e backup SQLite consistente real.

A confirmação da oferta exige prova de cadastro/sete dias, início, comportamento
no fim, funções incluídas e pagamento para continuar. O CEO continua a decidir
sobre factos observados, sem fingir validação automática da Base44. A API recusa
ativação sem prova correspondente e rejeita configurações alteradas. Provas
simuladas não podem ativar a oferta num processo operacional.

Reutilizam-se `OllamaInferenceAdapter`, fila/dependências/eventos, consentimento,
versões/aprovações, bloqueio após transferência e feed HMAC existente. Não há outro
motor, CRM, inbox ou conector paralelo. A inferência continua só loopback, com
proveniência ligada por digest ao endpoint/modelo atual. Sem modelo não há execução
fictícia. Erros, modelo, duração e resultado continuam nas tarefas persistentes.

Backups usam a API online SQLite, ficheiros 0600/pasta 0700, integridade, SHA-256,
retenção das cinco cópias próprias e recusa de diretório symlink. Isto não substitui
backup privado fora da máquina nem prova de recuperação num host independente.

## Validação executada

- Build completo inclui tipos e lint. Mantêm-se apenas avisos anteriores de
  useEffect, bundle acima de 500 kB e SQLite experimental.
- Suite preserva os **1.105 testes** da Fase 6 e acrescenta **13** de prontidão,
  autenticação, oferta, configuração, oito contratos simulados, interrupção,
  persistência, backup, permissões e recuperação. Total: **1.118**
  (196 interface + 915 servidor + 7 contratos de pacote).
- AsyncAPI; cinco regressões Chromium Fases 2–6; cenário operacional Fase 7.
- Jornada fictícia: importação Hunter, plano Nexus aprovado, sete etapas e síntese,
  oito personagens com atividade da fila, convite aprovado/confirmado pelo Mock,
  transferência CEO, recusa explícita de trabalho dos agentes, cadastro/teste/recibo
  simulados, datas, alertas persistentes, relatório Orion e desktop/mobile.
- Instalação em fonte nova sem `node_modules`, `npm ci` e lockfile idêntico, build,
  acesso privado, carregamento real do escritório/assets por WebSocket, oito agentes,
  CRM/conversões simulados, comparação de todas as tabelas após reinício e recuperação
  de backup em outra pasta. Rotação do token é conferida separadamente.

Os testes de navegador do escritório usam um browser de fixtures; não validam o
sandbox do conector WhatsApp. Testes de IA usam emulador; feed Base44 usa contrato
injetado. Nem um nem outro comprova contas ou comunicação externas.
VS Code/Claude E2E e uma máquina/VM independente não foram executados.

## Preservação e dados

Backup consistente privado e hashes de todas as tabelas feitos antes de alterar
código. Schema permanece **v5**, sem remover entidades ou alterar IDs existentes.
As novas evidências usam `settings` e o log `events`. Não se restauraram fixtures
na pasta operacional nem se sobrescreveram sessões/credenciais. Licença MIT,
lockfile, Pixel Agents/editor, funcionários, CRM, conversas, consentimentos,
pagamentos e transferência das fases anteriores foram mantidos.

Na execução operacional, a comparação de todas as tabelas passou antes e depois
do arranque Fase 7. Só depois foram registadas a verificação técnica, uma cópia
consistente privada e a indisponibilidade real de inferência. O hash/permissões
do novo backup passaram. Nenhuma tarefa, empresa, conta, teste ou recibo fictício
foi inserido. O URL informado permanece e a oferta continua inativa. Smoke
HTTP/WebSocket e rejeição de prontidão sem autenticação passaram.

## Revisão de segurança para o piloto

Revisão de código e testes de fronteiras existentes/novas; não é auditoria externa
ou certificação de produção.

| Controlo | Verificação e limite |
| --- | --- |
| Autenticação/rotas/WebSockets | Token, Host e Origin mantidos; novas rotas dentro do mesmo escopo privado; sem webhook público. Testes de rejeição sem token/origem/host válidos |
| Acessos | Token de capacidade único do CEO; não existe gestão multiutilizador. Rotação/rejeição de token antigo disponível; usar canal privado |
| Sessões/segredos/logs | Dados fora de Git; QR/sessão não publicados; log de arranque contém URL sensível e precisa de permissões privadas. Nunca publicar terminal/log/token |
| Backups/permissões | SQLite 0600, diretório privado, backup consistente e digest; rejeita symlink. Exige cópia externa/ACL adequada no sistema de destino |
| Retenção | Payloads antigos do Conversion Engine têm política existente; restantes históricos e cópias externas exigem política explícita do operador |
| Limites/tarefas | Limites existentes de fila, concorrência, contexto, orçamento e timeout; reinício não repete inferências/envios incertos |
| Prompt injection | Conteúdo externo como dados não confiáveis, JSON validado, sem ferramentas administrativas/envio no modelo. Qualidade/factualidade exige revisão humana |
| Mensagens/aprovações | Consentimento vigente, contacto exato, versão imutável e aprovação individual, aceitação do link e revalidação; falha ambígua exige reconciliação |
| CEO/revogação | Transferência bloqueia agentes; opt-out, pausa global e revogação de sessão existentes. Confirmar também Dispositivos associados no telefone no teste real |
| Base44 | HMAC, app/nonce/timestamp, validação limitada, idempotência e SSRF/redirect protegidos; service role só no backend autorizado. Nenhuma credencial fictícia é tratada como real |
| Exposição | Servidor e Ollama em loopback. Nenhuma publicação administrativa na internet. Acesso remoto exige canal privado autorizado, HTTPS/autenticação e Hosts explícitos |

## Próximos passos do proprietário

1. Verificar recursos do computador e seguir [instalação local/Ollama](AGEXA_LOCAL_SETUP.md).
2. Executar e rever inferência real separadamente para cada funcionário.
3. Configurar no editor os [artefactos e passos Base44](AGEXA_BASE44.md), confirmar
   oferta e efetuar teste autorizado. Não ativar plano pago sem decisão explícita.
4. Preparar número secundário e seguir [checklist WhatsApp](AGEXA_VALIDATION.md),
   sem número principal, mensagens não solicitadas ou modo automático.
5. Repetir instalação/recuperação numa máquina independente antes de declarar esse
   critério encerrado. Manter a máquina ligada para execução dos agentes.

O rascunho do ambiente e o push não publicam o servidor. Rever/guardar as definições
e publicar pelo produto quando adequado. O servidor administrativo deve permanecer privado.
