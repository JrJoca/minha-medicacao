# Testes de aceite e regressão

Status desta preparação: roteiro criado; não executado localmente por indisponibilidade do ambiente. Metadados de deploy, HTTP 200, schema e políticas foram consultados, mas isso não é um teste E2E.

Executar cenários com escrita apenas em ambiente de teste e dados sintéticos. Não fazer teste de carga/brute force na produção.

| ID | Cenário | Resultado esperado |
|---|---|---|
| T01 | Instalação com pnpm 11.25.0 e frozen lockfile | Sem atualizar lockfile implicitamente |
| T02 | Lint, tsc --noEmit e build | Registrar resultado real e pendências preexistentes |
| T03 | Login, logout e recarregamento | Sessão correta; logout não deixa dados de outro usuário na UI |
| T04 | Usuário A consulta dados de B pela API | Nenhum acesso; RLS não depende da UI |
| T05 | Anônimo consulta as quatro tabelas | Nenhuma leitura de linhas médicas |
| T06 | Viewer consulta escopo associado e tenta escrita direta | Leitura só do proprietário associado; escrita bloqueada em todas as tabelas |
| T07 | Cadastro de medicamento e lista | Nome/dose/link persistem após recarregar |
| T08 | Rotina seleciona itens por lista + | Sem duplicatas; remoção da seleção funciona |
| T09 | Duração 30 dias, 4 semanas e uso contínuo | total_days 30/28/nulo; campos coerentes |
| T10 | Editar, pausar, retomar, excluir rotina | Efeito isolado e feedback claro; verificar cascatas antes de excluir |
| T11 | Rotinas cadastradas fora de ordem | Exibição crescente por horário |
| T12 | Próxima rotina com vencida, futura, concluída e pausada | Seleciona futura ativa não concluída; atual comportamento não busca amanhã |
| T13 | Concluir rotina e recarregar | Uma tomada e horário persistido; duplo clique/duas abas não devem duplicar |
| T14 | WhatsApp aberto alguns minutos depois | Mensagem mantém horário de taken_at, não horário do envio |
| T15 | Editar data/hora de um registro | Só a ocorrência selecionada muda; conflito de mesmo dia é tratado |
| T16 | Desmarcar no histórico | Remove tomada selecionada; status derivado volta conforme data |
| T17 | Hoje após limite e dia anterior sem tomada | Pendente hoje; Não tomado só para dia encerrado |
| T18 | Manter app aberto durante meia-noite | Recalcular datas e tomadas; há limitação de atualização automática a revisar |
| T19 | Relatório com data futura ou anterior à criação | Não inventar faltas; código atual precisa revisão nesses casos |
| T20 | Alterar dosagem/medicamentos após tomada antiga | Histórico deve preservar fatos; snapshots ainda não existem |
| T21 | Frequência não diária e fim de tratamento | Não gerar ocorrências indevidas; motor de recorrência/fim ainda não implementado |
| T22 | Contador de dias atravessa datas/pausas | Critério precisa ser definido e implementado; current_day não avança no código atual |
| T23 | OCR digitado nítido, desfocado e sem remédios | Rascunhos revisáveis; erro amigável; nada salvo antes de confirmar |
| T24 | OCR edição/exclusão e cadastro em lote | Só itens confirmados válidos são persistidos |
| T25 | Imagem inválida, >10 MB e PDF | Recusar formato não suportado sem congelar interface |
| T26 | 320, 360, 390, 768 e 1280 px | Sem corte de botões/diálogos; relatório utilizável por toque e teclado |
| T27 | Labels, foco, fechamento e mensagens | Acessibilidade básica sem perda de foco |
| T28 | Offline, token expirado e falha de rede | Não exibir falso sucesso nem perder alteração silenciosamente |
| T29 | Links com protocolo inesperado | Recusar; validação de protocolo ainda é pendência |
| T30 | APK: login, cadastros e notificações | Mesmas regras e permissões testadas em aparelho real |
| T31 | Rotina pausada, finalizada ou já concluída | Notificações devem respeitar regras; implementação nativa atual precisa revisão |
| T32 | Produção após publicação autorizada | READY, SHA esperado, domínio certo e smoke test sem alterar dados reais |

Não há script test no package.json revisado. Recomenda-se adicionar unitários para datas, ordenação, status e parser OCR; testes de integração de RLS; E2E para fluxo de rotina/relatório. Ferramentas e versões devem ser escolhidas em tarefa própria e registradas no lockfile.
