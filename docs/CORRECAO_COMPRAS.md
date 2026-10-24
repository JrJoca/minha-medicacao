# Edição de cadastros e correção de compras

Implementado para revisão/implantação. Nenhuma correção clínica é aplicada
automaticamente pela migração ou pelos testes.

## Fluxos

- **Editar cadastro:** nome, dosagem e link do medicamento. Preserva ID, situação,
  saldo, doses, compras e movimentos anteriores. As rotinas exibem os dados atuais.
- **Ver compras → Editar compra:** quantidade, data, farmácia e link, com motivo
  obrigatório. A unidade da apresentação permanece a mesma.
- **Ver correções:** valores antes/depois, motivo, data/hora e diferença aplicada
  ao saldo. Proprietário e visualizador podem consultar; só o proprietário corrige.

Exemplo: saldo 10 + compra 10 − tomada 2 = 18. Corrigir a compra de 10 para 6
aplica −4 ao saldo atual, que passa a 14. Desfazer a tomada original devolve 2,
resultando em 16. Nenhuma tomada anterior é recalculada ou apagada.

Data, farmácia e link corrigidos com quantidade igual não movimentam estoque.
A redução pode gerar saldo negativo, que continua sinalizado, preservando as
ocorrências já registradas. A conferência física permanece um ajuste explícito.

A primeira compra continua exigindo saldo conhecido. Uma correção de quantidade
também exige saldo/unidade consistentes; uma correção apenas de informação pode
ser registrada sem alterar saldo. Valores e motivo são validados no cliente e
no servidor. O cliente mantém o rascunho após falha de conexão.

## Concorrência e idempotência

Cada compra recebe uma revisão inicialmente zero. A correção deve usar a revisão
lida pelo formulário; se outro acesso já corrigiu o registro, o servidor recusa
uma edição antiga e a interface oferece recarregar/revisar. Comandos repetidos
reutilizam seu identificador e não reaplicam a diferença, mesmo após novas tomadas.
Salvar sem alterações não cria movimento nem auditoria fictícia.

## Migração 006 e preservação

`202610240006_purchase_corrections.sql` depende de 005 e acrescenta somente:

- Revisão na compra, com zero para todos os registros anteriores.
- `medication_purchase_corrections`, com RLS e leitura para o escopo autorizado.
- RPC `correct_medication_purchase`, que verifica a identidade oficial/owner,
  bloqueia a compra e o medicamento, ajusta a diferença, registra snapshots e
  cacheia o resultado na mesma transação.

A trilha original de compra permanece imutável. Uma diferença de quantidade gera
novo movimento de ajuste, vinculado à auditoria; não altera o movimento original.
Os clientes continuam sem INSERT/UPDATE/DELETE direto nas compras e nas auditorias.
Não há doses inferidas, movimentos retroativos, alteração de contas ou consulta a
`public.links`.

O executor `scripts/neon-purchase-corrections.py` exige destino confirmado, backup
privado da última hora com checksum e branch de recuperação. Compara todos os
campos anteriores das quatro tabelas originais, contas, estoque, compras,
movimentos e comandos. Qualquer divergência reverte toda a migração. Reexecução
sobre a ampliação já aplicada é recusada.

## Implantação após revisão

1. Conferir o commit aprovado, executar testes/tipos/lint/build e ensaiar o SQL
   exato em branch sintética com 005, sem reinicializar dados reais.
2. Fazer backup com `python3 scripts/neon-purchase-corrections.py backup
   --production-authorized --output /DIRETORIO_PRIVADO_NOVO`.
3. Aplicar com `python3 scripts/neon-purchase-corrections.py apply
   --production-authorized --backup /DIRETORIO_PRIVADO_NOVO/neon_snapshot.json`.
4. Conferir `status --production-authorized`. Se apenas o cache da API falhar,
   usar `refresh-cache --production-authorized`; não repetir apply.
5. Publicar o frontend e validar as páginas públicas, código/URLs e login sem
   criar compras ou tomadas fictícias na produção. As contas reais validam a UI.

Rollback do frontend não apaga a auditoria nem reverte correções já confirmadas.
Não restaurar snapshot antigo sobre novas compras/tomadas; corrigir para frente e
preservar/reconciliar os eventos posteriores. Android permanece como última etapa.

## Validação

192 testes locais, TypeScript, lint com o aviso preexistente de imagem do OCR e
build. O ensaio de 006 preservou as compras e os comandos anteriores; testes de
falha comprovam rollback da ampliação. Auth/Data API reais foram exercitados em
branch sintética, inclusive concorrência, retry, revisão antiga, metadata sem
movimento, saldo negativo e isolamento. Dezenove cenários de navegador cobrem
edição de cadastro e compras, cancelamento, validações, persistência, erro de rede,
baixa/estorno, histórico, conflito/recarregamento, visualizador e celular entre
320 e 1280 px. Zero erros de página e nenhuma escrita clínica de teste em produção.
