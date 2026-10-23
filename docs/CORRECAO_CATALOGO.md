# Carregamento do cadastro de medicamentos

A conferência de origem/destino encontrou sete medicamentos, duas rotinas e sete
vínculos no Neon, com os mesmos IDs e conteúdos do Supabase. Os registros e as
tomadas posteriores do Neon foram preservados, sem reimportação ou duplicação.

O frontend descartava o resultado de medicamentos quando outra consulta do painel
falhava e mostrava cadastro vazio durante carregamento/erro. A correção:

- Carrega medicamentos independentemente das consultas de rotinas/tomadas.
- Diferencia carregamento, erro e cadastro realmente vazio, com nova tentativa.
- Preserva a última lista quando uma atualização falha.
- Confere vínculos quando a consulta retorna vazia; se houver medicamentos nas
  rotinas, tenta ler seus IDs pelo mesmo cliente autenticado e pelas mesmas RLS.
  Identifica a lista recuperada como medicamentos usados nas rotinas, pois pode
  haver outros registros fora delas. Inconsistências não viram cadastro vazio.
- Aguarda uma consulta válida para criar/editar rotinas. O aviso de cadastrar um
  medicamento fica restrito à ausência confirmada de medicamentos e vínculos.
- Descarta respostas antigas após troca de conta ou nova consulta.
- Remove a mensagem antiga que afirmava salvar no Supabase.

Não altera SQL, RLS, contas, senhas, tabelas ou dados clínicos. A correção se baseia
na versão de produção e não inclui a ampliação de estoque do PR #3.

Validação: 58 testes locais (28 de banco/migração, 22 de proteção do executor e
8 de catálogo), TypeScript, lint e build. Lint mantém um aviso de imagem do OCR.
O navegador usa login de fixtures Neon e respostas de leitura sintéticas, com
sete medicamentos, para exercitar lentidão, erro, recuperação por vínculos,
seleção na rotina, retry, vazio verdadeiro, perfil visualizador e celular.
Nenhuma gravação clínica é feita nesses testes. As capturas usam apenas fixtures.

A leitura na sessão real do usuário continua protegida pelo login. Não foram
extraídas credenciais, simuladas identidades de produção ou fabricadas doses.
