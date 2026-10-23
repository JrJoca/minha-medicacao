# Carregamento de medicamentos, rotinas e data do painel

A conferência de origem/destino encontrou sete medicamentos, duas rotinas e sete
vínculos no Neon, com os mesmos IDs e conteúdos do Supabase. Os registros e as
tomadas posteriores do Neon foram preservados, sem reimportação ou duplicação.

O frontend descartava todos os resultados quando uma consulta auxiliar falhava e
mostrava cadastro vazio durante carregamento/erro. O cabeçalho trazia uma data e
saudação fixas. A correção:

- Carrega medicamentos e rotinas independentemente dos vínculos e das tomadas.
  Falhas auxiliares mantêm os cartões e mostram um aviso, com nova tentativa.
- Diferencia carregamento, erro e ausência confirmada; preserva a última lista
  durante falhas de atualização. Os contadores não mostram zero como erro.
- Quando uma lista retorna vazia com vínculos conhecidos, tenta consultar seus
  IDs pelo mesmo cliente autenticado e pelas mesmas RLS. A lista recuperada é
  identificada como parcial; registros fora das rotinas podem não estar nela.
- Aguarda leituras válidas para editar rotinas ou confirmar/desfazer tomadas.
  Respostas antigas após troca de conta ou nova consulta são descartadas.
- Consulta os vínculos sem exigir colunas novas de dose, mantendo compatibilidade
  com o esquema anterior à ampliação de estoque.
- Mostra data completa e saudação atuais no fuso do dispositivo; atualiza o relógio
  a cada 30 segundos e ao voltar à janela. Na mudança do dia, recarrega as
  confirmações com limites de início/fim locais. Não conserva uma confirmação
  do dia anterior como concluída hoje.
- Remove as mensagens fixas de próxima rotina e gravação no Supabase.

Não altera SQL, RLS, contas, senhas ou dados clínicos. O PR #4 se baseia na versão
atual de produção e não inclui a ampliação de estoque do PR #3. Esta correção também integra o PR #3 para manter a interface de estoque compatível;
medicamentos e rotinas continuam visíveis mesmo se o serviço de estoque falhar.

Validação automatizada: 68 testes locais (28 de banco/migração, 22 de proteção
do executor e 18 de catálogo/data/rotinas), TypeScript, lint e build. O lint
mantém um aviso preexistente de imagem do OCR. Os testes de navegador usam contas
sintéticas Neon e respostas de leitura controladas, sem gravações clínicas,
para conferir carregamento, erros, recuperação, duas rotinas, sete medicamentos,
seleção no formulário, perfil visualizador, celular e virada do dia em Brasília.
As capturas contêm apenas fixtures. A publicação e a verificação pela sessão real
do usuário são etapas posteriores à revisão e aprovação.
