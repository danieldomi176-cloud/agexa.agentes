# Instalação e validação numa máquina de confiança — Fase 7

**Atualização de perfil:** o CEO utiliza Chromebook/ChromeOS com 2 GB. Não executar
esta instalação no Chromebook: usar o [guia de IA na nuvem](AGEXA_CHROMEBOOK.md).
Os passos abaixo destinam-se ao backend noutra máquina; Ollama passa a ser opcional.

Não foi instalado Ollama nem descarregado qualquer modelo nesta tarefa. O CEO
confirmou que ainda não dispõe desses componentes e pediu preparação independente.
Os números medidos na nuvem **não descrevem o computador pessoal do CEO**.

## Verificar primeiro o computador

Instalar Node **22.23.4** pelo distribuidor oficial, conservando o instalador/checksum
e a arquitetura. Git é necessário. No terminal da máquina onde o Office vai correr:

```bash
node --version
git --version
node scripts/agexa-host-check.mjs
```

O último comando exige o código já clonado. Não instala nada, não descarrega modelos
e consulta apenas o Ollama loopback. Em Windows, consultar também Gestor de Tarefas
→ Desempenho (CPU/RAM/GPU); em macOS, Informação do Sistema/Monitor de Atividade;
em Linux, `free -h`, `df -h` e, se existir driver NVIDIA, `nvidia-smi`.
O script não certifica aceleração GPU em Windows/macOS nem mede qualidade do modelo.

Para uma avaliação inicial em CPU, preferir pelo menos **8 GiB de RAM**, cerca de
**6 GiB livres**, quatro núcleos e **10 GiB de disco livres** para aplicação,
dependências e um modelo pequeno. São margens de planeamento, não requisitos
universais nem benchmark. Não avançar com swap excessivo, disco quase cheio ou
falta de memória disponível. Equipamentos menores exigem avaliação específica.

Na nuvem observámos Debian 13 x64, quota de 4 CPUs, limite cgroup de 32 GiB RAM,
aproximadamente 29 GiB livres de disco e nenhum dispositivo GPU exposto.
Isso torna plausível avaliar CPU, mas **não comprova inferência**. Ollama ausente,
`127.0.0.1:11434` com `ECONNREFUSED`; nenhuma lista de modelos foi obtida.

## Instalar o Office sem depender de IA

No terminal Bash de uma máquina autorizada:

```bash
git clone --branch agexa/phase-7 https://github.com/danieldomi176-cloud/agexa.agentes.git
cd agexa.agentes
node --version # deve ser 22.23.4
PUPPETEER_SKIP_DOWNLOAD=true HUSKY=0 npm ci
npm run build
export AGEXA_DATA_DIR="$PWD/../agexa-private-data"
unset AGEXA_INFERENCE_TEST_MODE AGEXA_MESSAGING_TEST_MODE
umask 077
npm run start:agexa
```

Em PowerShell, os equivalentes para ambiente são:

```powershell
$env:PUPPETEER_SKIP_DOWNLOAD='true'
$env:HUSKY='0'
npm ci
npm run build
$env:AGEXA_DATA_DIR=Join-Path (Split-Path $PWD -Parent) 'agexa-private-data'
Remove-Item Env:AGEXA_INFERENCE_TEST_MODE -ErrorAction SilentlyContinue
Remove-Item Env:AGEXA_MESSAGING_TEST_MODE -ErrorAction SilentlyContinue
npm run start:agexa
```

Não usar `npm install` para atualizar versões. O lockfile da Fase 6 permanece fixado.
Guardar o commit efetivo com `git rev-parse HEAD`; para reproduzir uma entrega,
fazer checkout desse SHA, pois a branch pode avançar. O servidor liga apenas em
`127.0.0.1:3100`. O terminal contém o acesso administrativo privado: não partilhar,
fotografar ou colocar em Git. Em Windows proteger o diretório com ACL apenas para
o utilizador autorizado; verificar suporte a dependências nativas e o Chromium.
O procedimento Windows/macOS está documentado, não foi executado nesta nuvem.

## Preparar Ollama gratuito

1. Confirmar recursos da máquina e a autorização para instalar/descarregar.
2. Obter Ollama em [ollama.com/download](https://ollama.com/download) ou nas
   [releases oficiais](https://github.com/ollama/ollama/releases). Escolher e
   registar uma versão estável e checksum oficial. Não executar scripts remotos
   por `curl | sh` sem revisão. Não foi possível consultar a release mais recente
   pela API GitHub nesta rede; não se inventou uma versão verificada.
3. Usar apenas loopback. Manter `OLLAMA_HOST=127.0.0.1:11434`; não abrir a porta
   na internet. A aplicação usa exclusivamente endereços loopback.
4. Candidato inicial: **`qwen2.5:1.5b`**, pequeno, multilingue e com suporte a
   saída estruturada no protocolo Ollama. Verificar a licença/model card da
   variante concreta antes de descarregar (a variante 1.5B é publicada como
   Apache 2.0). Português comercial, factualidade e JSON exigem teste real;
   o nome do modelo não garante qualidade. Não escolher automaticamente um
   modelo maior nem instalar APIs pagas.
5. Só quando o operador decidir executar o download autorizado:

```bash
ollama --version
ollama pull qwen2.5:1.5b
ollama list
curl --fail http://127.0.0.1:11434/api/tags
```

O `pull` acima é uma instrução para o operador, **não foi executado**. Registar
versão Ollama, nome e digest efetivamente devolvidos em `/api/tags`. Tags podem
mudar; conservar o manifesto/digest e os artefactos autorizados para reprodução.
Se houver GPU compatível, verificar o driver e a compatibilidade oficial antes
de assumir aceleração. Em CPU, começar com uma inferência de cada vez e timeout
de até 180000 ms na Central IA. Manter limites de contexto/tarefas existentes.

## Teste real e prova dos oito funcionários

1. Central IA → verificar serviço → selecionar o nome realmente listado → guardar.
2. Prontidão operacional → Verificar NEXUS. A ordem controlada pede estratégia
   para barbearia fictícia na Beira, apenas com funcionalidades verificadas.
3. Em Tarefas, consultar ID, hora, modelo, duração, resultado JSON, erros e
   `executionMode`. `test` significa simulação; `ollama` é execução pelo serviço
   configurado. O hash da configuração liga a prova ao endpoint/modelo atual.
4. O contrato valida JSON, mas o CEO ainda deve avaliar utilidade, português e
   factos. Aprovar contrato não certifica verdade de todas as frases.
5. Repetir para os oito funcionários. Hunter usa dados fornecidos/CRM autorizado,
   não inventa pesquisas web; Sophia mantém a oferta bloqueada sem confirmação;
   Orion usa métricas verificadas. Botões não enviam mensagens nem alteram contas.
6. Para colaboração, Nexus → objetivo e contexto autorizado → pedir plano →
   rever sete etapas → aprovar. Nove tarefas dependentes, eventos e resultados
   persistem; personagens só trabalham enquanto o backend executa tarefas.

Se falhar, guardar erro, modelo e duração da tarefa, verificar memória e serviço.
Timeout/JSON inválido não têm fallback falso. Não repetir operações externas para
compensar uma falha de modelo. Sem serviço, a verificação regista indisponibilidade
e não cria tarefa fictícia de inferência.

## Ollama noutra máquina

Apenas por canal privado já autorizado. Exemplo para administrador com SSH permitido:

```bash
ssh -N -L 127.0.0.1:11434:127.0.0.1:11434 utilizador@maquina-de-confianca
```

O modelo permanece loopback no destino e o Office consulta loopback do seu servidor.
Confirmar identidade do host por canal confiável. Esta nuvem não dispõe de grant
TCP/SSH nem VPN configurados para esse destino; o túnel **não foi executado**.
Usar configuração privada autorizada, sem contornar o proxy ou publicar Ollama.

## Backup e recuperação

Prontidão operacional → Criar backup privado usa a API SQLite de backup online,
verifica integridade, SHA-256 e permissões, e retém as cinco cópias próprias mais
recentes em `AGEXA_DATA_DIR/backups/`. Não é backup fora da máquina. Copiar para
armazenamento privado autorizado e definir retenção externa. Não copiar apenas o
ficheiro SQLite aberto ignorando WAL/SHM.

Para recuperar, desligar o processo do **diretório de destino**, conservar a cópia
anterior e usar uma pasta nova privada. Copiar um backup consistente para
`nova-pasta/sales.sqlite`, iniciar com `AGEXA_DATA_DIR` apontado para ela e conferir
integridade/IDs/CRM/conversões. Não copiar `sales.lock`, ficheiros WAL/SHM antigos
nem sessões reais de WhatsApp como parte de um teste. O backup SQLite não contém
o token administrativo nem LocalAuth; o novo diretório gera novo acesso e o canal
fica desligado. Para rodar acesso existente, iniciar conscientemente com
`--rotate-token`; desligar clientes antigos e verificar rejeição do token anterior.

Teste automatizado, **sempre isolado de produção**, em Node 22:

```bash
npm run test:agexa:restore
```

Copia apenas fontes Git para pasta temporária, instala dependências de raiz, faz
build, cria empresa/conversão simuladas e verifica autenticação, migrações, oito
funcionários, WebSocket/assets e hashes de todas as tabelas após reinício/recuperação.
Usa o cache npm quando disponível, sem reaproveitar `node_modules`. Na nuvem o cache
é `/workspace/.npm-cache`; noutra máquina definir `AGEXA_NPM_CACHE` para uma pasta
gravável ou ajustar para o cache npm local. Não executar contra o diretório do CEO.

**Passou nesta mesma máquina. Uma máquina/VM independente continua por testar.**
Para encerrar esse critério, repetir os comandos num sistema independente, guardar
versões/checksums, resultado do build, smoke e teste de recuperação. Manter a
distinção entre restauração de dados fictícios e continuidade de contas externas.

O computador precisa de estar ligado e o processo em execução. Não existe serviço
externo que mantenha os agentes ativos quando esta máquina estiver desligada.
