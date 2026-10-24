# Hospedagem persistente e HTTPS da API do CEO

**Modelos de implantação; nenhum host, domínio ou serviço pago foi provisionado.**
Codex/Codespaces não são garantia de hospedagem permanente. O Office precisa de
processo Node 22 estável, disco persistente privado, backups e reinício supervisionado.
Chromebook ChromeOS 2 GB é só cliente web; não instala o backend nem Ollama.

## Topologia e artefactos

- Office em um único host/replica com Node **22**, `npm ci`, `npm run build` e
  `--agexa --no-terminal --host 127.0.0.1 --port 3100`.
- `AGEXA_DATA_DIR` aponta para volume persistente privado, fora do checkout.
- Proxy HTTPS com hostname real e certificado válido; só encaminha
  **POST `/api/ceo/v1/request`**. Restantes caminhos externos dão 404.
- Base44 Backend Function chama esse endpoint; browser só invoca a função Base44.
- `deploy/ceo/Caddyfile`: template de TLS/Host/tamanho/rota restrita.
- `deploy/ceo/agexa-office.service`: template systemd de processo persistente.
- `deploy/ceo/office.env.example`: configuração sem segredo, ponte desativada.

O binário Caddy não está instalado nesta sessão; o seu arranque/configuração real
não foram testados. O teste de integração usa proxy HTTPS Node local e valida CA/
hostname, sem desligar TLS. O template systemd requer adaptar caminhos, utilizador
e instalação Node 22 ao host real. Não foi iniciado como serviço do sistema.

## Preservar e transferir os dados

1. Confirmar o commit mais recente concluído e uma pasta operacional única.
   Não criar outro CRM/SQLite para o painel. Nunca testar com fixtures nessa pasta.
2. Fazer backup consistente com `node:sqlite backup`, com permissão 0600, fora do
   repositório. Incluir de forma privada a configuração e dados de sessão que o
   funcionamento atual realmente utiliza; proteger acesso a backups de mensagens.
3. Numa migração, parar graciosamente o processo original antes de promover o destino.
   Não copiar apenas um ficheiro SQLite vivo ignorando WAL. Verificar integrity_check,
   versão, hashes/IDs e volume montado antes/depois de abrir o backend restaurado.
4. Manter **um escritor/replica**, com lock existente, disco local adequado ao SQLite
   e backups fora do host. Não iniciar dois motores sobre a mesma base ou pôr o
   ficheiro num browser, CDN, volume efémero ou partilha de rede não validada.
5. Preservar Gemini/Ollama opcional, consentimentos, suspensões, oferta e integração
   Base44 anterior. Hospedar a API não confirma nem liga esses serviços.

## Configuração Office

No gestor seguro do **host backend**, preparar:

| Variável | Configuração real necessária |
| --- | --- |
| `AGEXA_CEO_BRIDGE_ENABLED` | `1` só após configurar host/IDs/chave; omissão ou 0 desativa |
| `AGEXA_OFFICE_PUBLIC_ORIGIN` | Origem HTTPS real, sem path/query/userinfo; ainda não fornecida |
| `AGEXA_CEO_TRUSTED_PROXY_IP` | IP exato do hop que termina HTTPS; template usa 127.0.0.1 |
| `AGEXA_CEO_READ_IDS` | User IDs imutáveis Base44 autorizados a leitura |
| `AGEXA_CEO_CONTROL_IDS` | User IDs imutáveis autorizados a confirmar controlo |
| `AGEXA_CEO_BRIDGE_SECRET_FILE` | Caminho absoluto de montagem privada da chave da ponte |

Alternativa à montagem: `AGEXA_CEO_BRIDGE_SECRET` bruto fornecido pelo gestor de
runtime. Usar **uma** fonte. Mínimo 32 caracteres, máximo 4096 bytes UTF-8 exatos,
sem CR/LF/NUL. Ficheiro regular, sem symlink, proprietário do utilizador Node,
modo 0600/0400, diretório privado. O leitor não faz trim. Não usar `echo` que
acrescente newline. Não colocar valor em env versionado, argumentos, SQLite ou logs.

A chave deve ser a mesma em Office e função Base44, **exclusiva da ponte**, diferente
da chave do feed comercial. Não gerar/publicar credenciais de exemplo como reais.
O caminho sugerido `/run/secrets/agexa_ceo_bridge_secret` não cria ficheiro/mount:
o gestor do host deve montá-lo em runtime fora de snapshots/backups do projeto.
Bindings de proxy que só substituem headers não entregam material para assinar HMAC
localmente. A ferramenta desta nuvem não provisionou essa chave bruta.

Allowlist vazia ou origem inválida com ponte ativada impede configuração válida;
chave indisponível recusa os pedidos com 503. IDs repetidos em leitura e controlo
recebem controlo; configurar só as pessoas autorizadas. Não usar App ID/email/role
como substituto de User ID. Remover IDs/chave e aplicar reinício para revogar acesso.

## HTTPS e supervisor

1. Preparar host/disco/Node 22 gratuitos apenas se a conta/plano realmente permitir;
   não contratar serviço ou assumir disponibilidade 24/7 sem evidência.
2. Instalar dependências com lockfile e `PUPPETEER_SKIP_DOWNLOAD=true`. Verificar
   Node 22 em `/usr/bin/node` ou adaptar `ExecStart` ao caminho absoluto real.
   O Chromebook não executa estes comandos.
3. No template systemd, criar utilizador de serviço `agexa` sem login e apontar
   WorkingDirectory para o checkout real (template `/opt/agexa/agexa.agentes`).
   `AGEXA_DATA_DIR=/var/lib/agexa` deve ser o volume persistente restaurado, com
   ownership desse utilizador. `StateDirectory` não substitui volume persistente
   numa plataforma que elimina o disco no reinício.
4. Guardar configuração não secreta e requisitos existentes em
   `/etc/agexa/office.env`, legível apenas pelo operador/serviço; montar a chave
   privadamente. Preservar configurações atuais de IA/WhatsApp/feed. Não rodar o token
   legado sem necessidade nem publicar os seus URLs de bootstrap.
5. Validar `systemd-analyze verify` e hardening no host real antes de instalar/iniciar.
   O template é um exemplo, não garante compatibilidade com Chromium/namespace/
   permissões do host. A integração WhatsApp real continua dependente de testes próprios.
6. Configurar DNS do hostname real do Office para o proxy e certificado válido.
   `AGEXA_OFFICE_PUBLIC_HOST` do Caddy contém só o hostname; Office usa a origem
   `https://` correspondente. Não reutilizar o domínio da app Base44 como se fosse
   automaticamente o host do Office. Não existe URL de produção inventado.
7. Validar Caddy e regras de firewall: Node acessível só em loopback; portas públicas
   do proxy conforme emissão TLS e HTTPS. O proxy fixa Host e X-Forwarded-Proto.
   Não confiar num X-Forwarded-Proto vindo de qualquer cliente; o Office verifica
   também o IP real do hop confiável. Não publicar `/api/agexa`, `/ws`, hooks,
   `/terminal`, ficheiros, assets administrativos ou SPA através desta origem.
8. Ativar/iniciar apenas com configuração completa. Em modo ponte o CLI suprime o
   URL de bootstrap com token permanente. Logs HTTP não incluem headers/corpos de
   autenticação. Proteger journal/logs/backups e não os publicar no GitHub.
9. Executar smoke interno, pedido assinado via BFF, verificações negativas, restart
   e comparação dos dados. Só depois declarar a hospedagem operacional.

O transporte Base44→Office usa HTTPS nativo com redirects recusados. Não desativar
TLS, remover proxy ou contornar rede. Se o host/ambiente limitar saída, permitir
somente os destinos reais necessários pelos mecanismos suportados. O transporte
anterior do feed comercial com DNS fixado conserva a sua política independente.
Publicar esta ponte não resolve automaticamente o bloqueio daquele feed.

## Estado desta sessão

O backend temporário existente continua privado na porta interna 3100. A ponte
permanece **desativada**, sem host público/IDs de CEO/chave configurados e sem tabelas
CEO na base operacional enquanto desativada. Não houve ativação externa, inferência,
envio WhatsApp, cadastro ou pagamento real. Planos, TLS público, login e publicação
Base44 ainda precisam de validação autorizada no serviço real.

Rascunho de ambiente não é hospedagem persistente nem implantação Base44.
Ver [contrato API](AGEXA_CEO_API.md) e [frontend](AGEXA_BASE44_CEO_FRONTEND.md).
