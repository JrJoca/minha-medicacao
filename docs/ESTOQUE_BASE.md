# Base de estoque no Neon

Escopo solicitado em 22/10/2026: ampliar o banco para total de comprimidos,
comprimidos por caixa e consumo diário, mantendo o cadastro atual do medicamento.
O usuário confirmou a validação das duas contas e colocou o Android como última etapa.

## Estado da entrega

- Aplicada no Neon de produção em 22/10/2026 às 16:45 (America/Sao_Paulo).
- Versão `202610220003_medication_stock`, checksum
  `efc465bb11b33be6d367bcfd6e80f2dbe08186e7512d0a97ae75df25bc1fc664`.
- Branch privada de recuperação sem endpoint: `br-lively-recipe-b515t3y3`;
  snapshot local privado verificado. Nenhum arquivo de backup foi versionado.
- Comparação na transação confirmou a preservação dos registros existentes.
- RLS habilitado, quatro políticas e acesso anônimo bloqueado; nenhum medicamento
  foi preenchido automaticamente com estoque.
- 69 testes aprovados; instalação congelada, TypeScript e build passaram.
  Lint passou com um aviso preexistente de imagem.
- Ensaio remoto e API real com fixtures confirmaram 10 / 2 = 5, dias parciais,
  visualizador somente leitura e isolamento de contas. Nenhuma escrita de teste
  foi feita em dados de pacientes.
- Interface e cadastro de medicamento preservados. Configuração visual, compras,
  baixas e estornos continuam como próximas entregas.

## Modelo e cálculo

`public.medication_stock` complementa `public.medications`, com no máximo um
registro por medicamento. A FK composta mantém o mesmo proprietário nos dois
registros. O cadastro continua aceitando os campos anteriores, sem exigir estoque.
Esta entrega não modifica a interface.

| Campo | Significado |
|---|---|
| `total_tablets` | Total físico disponível declarado, inteiro maior ou igual a zero; NULL é não informado. |
| `tablets_per_box` | Comprimidos por caixa, inteiro positivo, opcional. Uma caixa parcialmente utilizada pode ter saldo menor que esse valor. |
| `tablets_per_day` | Total de comprimidos consumidos por dia, inteiro positivo, explicitamente informado. |
| `estimated_days` | Cálculo gerado pelo banco: total / consumo diário. Não pode ser informado manualmente. |
| `full_days_covered` | Quantos dias inteiros de consumo estão cobertos. |
| `created_at` / `updated_at` | Datas do registro; a atualização conserva a criação e registra a alteração no servidor. |

Exemplos: 10 comprimidos / 2 por dia = 5 dias; 10 / 3 = aproximadamente 3,33 dias,
com 3 dias completos. Zero informado resulta em zero dias; saldo ou consumo
desconhecido resulta em previsão NULL. O tamanho da caixa não altera o saldo
físico informado nem multiplica o consumo diário.

Nesta base são usados comprimidos inteiros. Frações continuam como decisão futura.
A frequência é o consumo diário declarado para uma estimativa simples: não é
inferida de “500 mg”, de texto livre ou do OCR. A previsão por ocorrências,
horários, pausas e várias rotinas continua na sequência de implementação.

`public.medication_stock_summary()` retorna os medicamentos permitidos pelo RLS,
inclusive os que ainda não têm estoque, com campos NULL. Usa SECURITY INVOKER;
não contorna o RLS. Não recebe o papel do usuário como parâmetro.

## Preservação e permissões

- Nenhum medicamento, rotina, vínculo, tomada ou conta é reescrito pela migração.
- Nenhum estoque é preenchido com zero por padrão; não há baixa retroativa.
- Proprietário altera somente o estoque dos seus medicamentos. Viewer consulta
  somente o proprietário vinculado; não insere, altera ou exclui.
- Outro proprietário, anônimo e conta desativada não recebem acesso ao escopo alheio.
- Campos calculados são gerados no banco. Saldo negativo, caixa não positiva e
  consumo diário não positivo são recusados.
- A tabela privada `schema_migrations` registra versão, checksum e referência
  do backup, sem acesso por clientes da aplicação.
- Não há compras, baixas, estornos ou consumo automático nesta etapa. Esses
  movimentos e sua auditoria serão implementados antes de integrar a confirmação
  de tomada ao estoque. A confirmação atual continua funcionando como antes.
- A exclusão de um medicamento remove apenas sua configuração de estoque. O
  futuro histórico de movimentos exigirá arquivamento/proteção própria, antes
  de existir qualquer baixa ou fato contábil nesse modelo.

## Ensaio, backup e aplicação

SQL: `neon/migrations/202610220003_medication_stock.sql`.
Executor: `scripts/neon-stock-schema.py`.

1. Executar `pnpm test:migration`, instalação congelada, lint, TypeScript e build.
2. Ensaiar no Neon sintético. O executor de ensaio continua recusando produção.
3. Apresentar o diff/SQL e as evidências. A ampliação do banco foi solicitada
   explicitamente; não há alteração de formulário nesta entrega.
4. Criar snapshot privado consistente, conferir seu SHA-256 e criar uma branch
   de recuperação sem endpoint a partir da produção. A branch conserva também
   Auth e objetos do banco; o snapshot local não lê senhas/tokens do Neon Auth.
5. Aplicar em uma transação serializável. O executor compara os registros das
   quatro tabelas e as contas antes/depois; qualquer diferença aborta a transação.
6. Registrar a versão/checksum/backup e atualizar o cache da Data API.
7. Consultar metadados e fazer somente verificações seguras em produção.
   Escritas de teste são exclusivas das fixtures sintéticas.

```bash
python3 scripts/neon-stock-schema.py rehearse --staging-branch BRANCH_DE_FIXTURES
python3 scripts/neon-stock-schema.py backup --production-authorized --output /privado/backup-novo
python3 scripts/neon-stock-schema.py apply --production-authorized --backup /privado/backup-novo/neon_snapshot.json
python3 scripts/neon-stock-schema.py status --production-authorized
```

Não repetir `apply` depois de um commit confirmado. Em falha somente no cache,
usar `status` e `refresh-cache`. O backup precisa ser privado, íntegro, do destino
correto, do mesmo SQL e obtido na última hora; a branch de recuperação é conferida
pela API antes de aplicar. O preparador do corte Supabase/Neon não é reaplicado.

## Recuperação e próximas entregas

Uma falha dentro da transação reverte a ampliação. Depois de uma aplicação
concluída, o cliente anterior continua compatível; deixar a nova tabela sem uso
é preferível a apagar registros. Não apagar o estoque nem restaurar uma branch
antiga sobre novas gravações. Se houver necessidade de recuperação, preservar
os dados novos e reconciliar os deltas antes de redirecionar a aplicação.

A próxima interface deverá configurar o estoque separadamente do cadastro
atual do medicamento. Compras, movimentos, doses por rotina, confirmação/estorno
atômicos e previsão por agenda serão entregas posteriores. Android fica por último.
