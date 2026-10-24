# Fontes comerciais — Fase 4

Verificação em 24/10/2026. Não foi ativado nenhum diretório remoto por defeito.
Acesso público a uma página não prova autorização para extração nem consentimento
para publicidade. Uma fonte autorizada não concede autorização para contactar as
empresas nela registadas: o CRM guarda consentimento separado por canal.

| Fonte | Implementação | Autorização, limites e restrições |
| --- | --- | --- |
| CSV empresarial do CEO | Operacional, executado por Hunter em tarefa persistente | CEO confirma origem, termos, reutilização comercial e dados empresariais mínimos. Até 48.000 bytes, 200 registos por lote, configurável para menos. Regista atribuição, data e modo; preserva duplicados existentes. |
| Lista empresarial do CEO | Operacional, JSON no painel | Mesmas confirmações e limite de registos do CSV; nenhuma recolha automática de pessoas. |
| Website empresarial indicado pelo CEO | Adaptador implementado, **indisponível neste ambiente com proxy** | Requer fonte aprovada, mesmo origin HTTPS, DNS público fixado na ligação, robots.txt permissivo, sem redirecionamentos nem conteúdo comprimido. Até 48.000 bytes de robots e 262.144 bytes de HTML, timeout de 10 s por pedido. Só título/descrição mínimos, com emails/telefones removidos; não extrai contactos. Testado com transporte injetado em testes, sem alegar pesquisa externa real. |
| OpenStreetMap | Candidato investigado, sem conector ativo | Base sob ODbL; exige atribuição a contribuidores, referência à licença e obrigações de partilha da base derivada quando aplicáveis. Não confere consentimento comercial. Regras e quotas do operador de API são separadas; não ficaram verificadas, pelo que não foi ativada uma API. |
| Wikidata | Não integrado | A página de licença consultada foi bloqueada pela rede; termos e limites não foram validados nesta execução. Não assumimos autorização. |
| Google Maps, Instagram, Facebook, LinkedIn | Sem extração automatizada | O adaptador de websites recusa estes domínios. Páginas empresariais podem ser referências introduzidas pelo CEO, sem scraping. Não há bypass de CAPTCHA, autenticação ou restrições. |

A política de rede desta nuvem recusou pedidos a `overpass-api.de` e à página de
licenciamento do Wikidata (HTTP 403 do proxy). Não foi tentado contornar o bloqueio.
A análise de websites recusa proxies sem transporte que garanta DNS público fixado;
retirar variáveis de proxy nesta nuvem não é um procedimento suportado. Em produção
com acesso HTTPS direto autorizado, o adaptador aplica as proteções acima. Qualquer
novo transporte de proxy precisa de garantir as mesmas propriedades antes de ativar.

A licença OSM foi consultada no código oficial do website, acessível pelo GitHub:

- [Página oficial de direitos](https://www.openstreetmap.org/copyright).
- [Código oficial da página](https://github.com/openstreetmap/openstreetmap-website/blob/master/app/views/site/copyright.html.erb).
- [Texto oficial de licença/atribuição em inglês](https://github.com/openstreetmap/openstreetmap-website/blob/master/config/locales/en.yml).
- [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- [Orientações de atribuição OSMF](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines).

Não confirmámos cobertura, qualidade ou volume de empresas em Moçambique através
de uma API. CSV/listas de origem autorizada são a via operacional nesta instância.
Não foram importadas empresas reais durante a validação.

Cada fonte pode ser pausada no painel. O limite padrão é de 10 operações por hora
por fonte (configurável entre 1 e 30), partilhado por importações e pesquisas
internas. Suspensão global e pausa de Hunter interrompem tarefas pelo motor
existente; uma fonte pausada é verificada antes de executar e antes de importar.
Nexus pesquisa os registos **já importados** da fonte escolhida, com filtros de
setor/cidade. Não apresenta esta seleção como descoberta nova na Internet.
