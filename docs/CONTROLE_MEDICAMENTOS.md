# Controle de medicamentos, compras e previsão

Implementado no PR #3 para revisão. A produção continua na correção do painel do
PR #4. As migrações 004 e 005 e a interface desta entrega não foram publicadas.

## Página e ativação

A navegação abre `/medicamentos`, com todos os medicamentos, filtros de ativos e
desativados, saldo, consumo diário e previsão. A tela de rotinas mantém o acesso
ao estoque. O cadastro original do medicamento e a revisão do OCR são preservados.

Desativar retira o medicamento das opções para **adicionar a uma rotina**. A regra
vale também no banco, inclusive para clientes anteriores. Os vínculos existentes,
saldos, compras e tomadas permanecem. Editar uma rotina pode manter o medicamento
já vinculado, identificado como desativado; não pode adicionar outro desativado.
A desativação não pausa tratamentos existentes. Para interromper uma rotina, use
Pausar/Arquivar. Reativar disponibiliza o remédio para novas rotinas.

Todos os medicamentos anteriores recebem `is_active=true`. O visualizador lê os
registros e o histórico, sem permissão de ativar, desativar ou movimentar estoque.

## Compras e conferência física

1. Confira o saldo físico inicial: quantidade disponível, unidade e quantidade
   por caixa/frasco. Em branco significa desconhecido; zero significa esgotado.
2. **Registrar compra** exige quantidade positiva, data até hoje e farmácia. Link
   http/https é opcional. A unidade acompanha o estoque, em comprimidos ou ml.
3. A compra soma unidades ao saldo atual e grava os metadados e o movimento na
   mesma transação. Exemplo: saldo 10 + compra 30 = 40. Compra com saldo inicial
   desconhecido pede conferência física; não pressupõe saldo zero.
4. **Ver compras** lista quantidade, data, farmácia e link, com paginação. O
   histórico é somente para leitura, inclusive para o proprietário.
5. **Conferir saldo físico** continua sendo um ajuste explícito, diferente de
   registrar compra. Pode corrigir a contagem sem apagar fatos anteriores.

Retry de uma compra reutiliza o identificador da operação enquanto o formulário
está aberto. Se o servidor salvou e a resposta se perdeu, tentar novamente não
soma duas vezes. Uma falha transacional não deixa compra ou movimento parcial.
Depois de uma falha, confira o histórico antes de fechar e iniciar outra compra.
Não existem compras inferidas a partir de saldos ou dados antigos.

## Dose e término do estoque

No cadastro da rotina, cada medicamento tem sua **quantidade por tomada** e
unidade. Para quetiapina, informar 2 comprimidos é independente da dosagem em mg.
A aplicação usa a quantidade declarada, sem prescrever nem inferir a dose.

A previsão soma os medicamentos das rotinas diárias ativas, respeita horários e
as confirmações de hoje já descontadas do saldo. Rotinas pausadas/arquivadas não
entram. Mostra a última tomada totalmente coberta e **Repor até**, a primeira
prevista sem quantidade suficiente. Se 10 comprimidos serão usados em uma dose
pendente de 2 por dia, há cinco tomadas cobertas. Duas rotinas de 1 também consomem
2 ao dia; uma nova compra ou uma alteração de dose recalcula as datas.

Para tratamento limitado, a simulação usa os dias restantes **configurados**
(`total_days-current_day+1`). Se o saldo cobre esse período, mostra “Cobre o
tratamento”, sem inventar uma falta posterior ao fim. A simulação não acrescenta
um calendário de início ou progressão de tratamento aos registros antigos.

Sem saldo, dose estruturada, unidade compatível ou frequência diária em todas as
rotinas ativas relevantes, mostra o motivo e não inventa uma data. Outras
recorrências permanecem sem previsão. Os cálculos usam o fuso do dispositivo e
são estimativas da configuração atual; não mudam a orientação médica.

Confirmar uma rotina baixa todos os medicamentos atomicamente; desfazer estorna
o consumo original. Faltar saldo preserva a tomada e sinaliza o saldo negativo,
conforme a escolha anterior do usuário. Alterar a dose não recalcula o passado.

## Banco e verificação

A migração `202610230005_medication_control.sql` depende de 004. Adiciona situação,
compras com RLS, movimentos de entrada e validação de ativos. O executor exige
backup privado recente/checksum, branch de recuperação, destino confirmado e
compara todos os campos anteriores, inclusive comandos, saldos e movimentos.
Qualquer diferença reverte a transação. Não consulta `public.links`.

161 testes locais aprovados, incluindo preservação/rollback da migração,
permissões, dose por item, compras, retry, calendário e unidades. TypeScript,
lint e build fazem parte da verificação. A API Neon foi exercitada somente em
branch sintética. Dez cenários de navegador passaram com Auth e dados reais de
fixtures: ativação, filtros, compras/histórico, perda de resposta com retry, doses,
baixa/estorno, navegação, visualizador, isolamento e celular de 320 a 1280 px.
Zero erros de página; nenhuma escrita de teste foi feita na produção.

A publicação exige revisão desta entrega e aplicação de 004 e 005 antes do
frontend. O teste autenticado das contas reais vem depois da implantação aprovada.
Android permanece como última etapa.
