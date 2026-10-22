# Implantação da ampliação 004

Status: SQL e interface implementados, ensaiados com dados sintéticos, **sem
aplicação desta migração em produção**. A migração 003 permanece imutável.

## Alterações

`202610220004_routine_stock.sql` adiciona quantidade/unidade ao estoque e aos
vínculos da rotina, frequência estruturada, arquivamento, ocorrência local e
indicador de tomada rastreada. Mantém os campos antigos. Novas tabelas:
`stock_movements` (RLS, leitura pelo cliente) e `application_private.stock_commands`
(privada, idempotência). As RPCs verificam o proprietário pela identidade oficial
Neon Auth e executam operações transacionais. Triggers cobrem também gravações
diretas de tomadas por clientes antigos.

O executor `scripts/neon-routine-stock.py` limita o destino de produção ao projeto
já aprovado, exige flag explícita, backup recente privado com checksum e branch
de recuperação do mesmo pai. Toda a ampliação e o registro de versão ocorrem numa
transação. Compara os campos anteriores das quatro tabelas originais, contas e
estoque antes/depois, incluindo timestamps; qualquer diferença cancela o upgrade.
Não consulta `public.links`. Não cria doses nem baixas antigas.

## Ordem, após revisão e autorização da implantação

1. Conferir o SHA aprovado e executar `pnpm test:migration`,
   `pnpm exec tsc --noEmit`, `pnpm lint` e o build de implantação.
2. Ensaiar a versão exata em uma branch não produtiva com fixtures, partindo de
   003. `rehearse` rejeita produção e reexecução sobre 004. Não reinicializar uma
   branch com dados reais para repetir testes.
3. Fazer backup com `python3 scripts/neon-routine-stock.py backup
   --production-authorized --output /CAMINHO_PRIVADO_FORA_DO_GIT`. O diretório deve
   estar vazio; os arquivos usam permissão restrita. Conferir manifesto/checksum,
   contagens e existência da branch de recuperação sem endpoint. Não publicar
   dados, credenciais ou arquivos privados no PR.
4. Aplicar com `python3 scripts/neon-routine-stock.py apply
   --production-authorized --backup /CAMINHO_PRIVADO_FORA_DO_GIT/neon_snapshot.json`.
   O backup tem validade de uma hora e deve corresponder ao checksum do SQL.
5. Usar `status --production-authorized`. Se apenas a atualização do cache falhar,
   executar `refresh-cache --production-authorized`; **não repetir apply**.
6. Publicar o frontend aprovado. URLs públicas do Neon permanecem iguais; nenhuma
   chave administrativa é introduzida no navegador. Validar acessos com owner e
   viewer sem criar tomadas fictícias nos dados de saúde.
7. Conferir configuração explícita de doses/saldos antes de ativar cada rotina.
   Android é a última entrega; APK antigo não recebe o novo formulário.

## Compensação

Um rollback de Vercel não reverte o PostgreSQL. A expansão mantém os campos
antigos, mas o cliente antigo não configura as doses das rotinas rastreadas.
Se houver problema após ativação, pausar os novos fluxos e corrigir para frente;
não apagar tabelas, movimentos, snapshots ou registros de comandos. Desfazer uma
tomada usa o estorno original. Conferência física gera ajuste rastreável.

A branch de backup e o snapshot servem para recuperação revisada. Não restaurar
uma cópia antiga sobre a produção depois de novas tomadas sem reconciliar os
registros posteriores; isso perderia fatos reais e estados de autenticação.
