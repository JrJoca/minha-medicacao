# Migração do Supabase para Neon

O escopo inclui banco, autenticação e API. O corte autorizado foi concluído na
aplicação web: Neon Auth, Data API e banco estão ativos em produção, com os IDs
e dados preservados. As duas pessoas definiram senhas e verificaram os e-mails;
os novos logins já estão vinculados às contas antigas. Consulte o registro
operacional em [CORTE_NEON.md](CORTE_NEON.md).

## Ambientes e estado

- Origem: projeto Supabase `llftfgtswvmwtbmkegpd`.
- Destino escolhido: projeto Neon `floral-pond-94925356`.
- Branch Neon existente: `br-muddy-term-b5xvw6i7`, chamada `production`.
- Branch criada para ensaio: `br-empty-water-b5nntdyc`, chamada
  `codex-supabase-migration-20261021`.
- Validação sintética isolada: `br-young-rain-b5wbapds`, chamada
  `codex-neon-validation-20261021`. Nunca usar como destino da produção.
- Código integrado pelo PR #1, commit `fb14c7f156d9ee356ce6ff6a6072110f550ab678`. Estado do
  corte e do destino final: [CORTE_NEON.md](CORTE_NEON.md).

`neon-migration.py` continua recusando restauração em branches default,
protegidas ou de produção. `neon-cutover.py` é o executor separado do corte
autorizado, restrito ao projeto/branch final. Na origem foram instalados apenas
o controle privado e triggers que bloqueiam escritas nas quatro tabelas migradas;
nenhuma linha de saúde foi alterada ou apagada na origem.

## Preservação de identidade e acesso

As quatro tabelas do domínio conservam seus campos, valores, IDs, datas e FKs
compostas por proprietário. `public.links` não é exportada nem modificada.
Não se faz normalização de dosagens, deduplicação por nome, criação de estoque
ou débito retroativo durante esta migração de infraestrutura.

O novo esquema `application_private` conserva os IDs antigos das contas e os
papéis proprietário/visualizador. O subject do novo provedor de login é uma
ligação separada (`auth_subject`), preenchida administrativamente. Assim, trocar
o login não exige reatribuir os dados a outro proprietário.

O Data API deve fornecer `auth.user_id()` a partir de um JWT validado. Antes de
esse helper existir, `request_subject()` retorna NULL e as políticas negam o
acesso. O executor remoto exige Neon Auth/Data API previamente provisionados, sem
grants amplos. Os roles de API devem ser NOLOGIN/NOBYPASSRLS. O provisionamento
do serviço recusa roles preexistentes: habilite os serviços antes da importação.
O bootstrap sem serviço existe somente para ensaios locais com acesso fechado. As políticas
consultam o vínculo e o papel protegidos no banco; não confiam em metadados
editáveis do cliente. Proprietário escreve apenas em suas linhas; visualizador
consulta apenas seu escopo e não escreve. Contas desativadas não recebem acesso.
A RPC `application_context()` fornece ao cliente seu ID estável e papel.

Não há vinculação automática por e-mail nem promoção automática a proprietário.
Uma conta ainda não vinculada não acessa os dados. `register_application_account()`
cria escopo próprio somente para contas novas com e-mail verificado no cadastro
canônico `neon_auth."user"`. Endereços de origem e reservas de migração não criam
outra conta: precisam da vinculação administrativa explícita.

## Transição das contas e senhas

O usuário escolheu Neon Auth com novas senhas para as duas contas. Foi informado
um endereço entregável para substituir o alias `.local` do visualizador. O plano
privado e as reservas no ensaio preservam os IDs antigos, o papel de visualizador
e seu proprietário. O e-mail anterior continua no registro de origem para auditoria.
Nenhum endereço real é versionado. Nos testes, o agente não escolheu senhas nem
enviou mensagens. Na ativação, cada pessoa criou seu próprio login e confirmou
seu e-mail pela interface; o serviço canônico confirmou ambas as verificações.

A [documentação oficial do Neon](https://neon.com/docs/auth/migrate/from-supabase)
informa que Managed Better Auth não importa senhas Supabase. Hashes ficam apenas
no backup privado e não são enviados ao Neon Auth. Sessões antigas não migram.

O cliente usa `@neondatabase/neon-js` **0.8.0-beta**, respeitando os sete dias de
maturação de dependências do projeto; não foi usada a versão publicada no dia.
O adaptador compatível mantém consultas PostgREST e login; cadastro e definição
ou recuperação de senha usam a API nativa de códigos por e-mail. O adaptador
não suporta trocar senha via `updateUser`, e o provedor de e-mail compartilhado
não aceita verificação por link. Confirmação e recuperação usam OTP na interface.

Roteiro de ativação executado; não repetir o cadastro das contas já vinculadas:

1. Provisionar o destino final e importar um snapshot atualizado, em janela de corte.
2. Reservar os e-mails aprovados antes de abrir o cadastro à aplicação.
3. Cada pessoa usa **Criar conta** com seu e-mail aprovado e uma senha nova,
   confirma o código recebido e aguarda a liberação. Senhas não são informadas no chat.
4. Conferir as duas identidades verificadas e executar a vinculação administrativa.
5. Entrar novamente e validar os dados e permissões de cada perfil.

O mapeamento fica fora do Git, em arquivo 0600; exemplo exclusivamente sintético:

```json
{"accounts":[
  {"legacy_id":"00000000-0000-4000-8000-000000000001","role":"owner","login_email":"owner@example.invalid"},
  {"legacy_id":"00000000-0000-4000-8000-000000000002","role":"viewer","login_email":"viewer@example.invalid"}
]}
```

Os comandos abaixo são limitados a ensaio. A vinculação é transacional: todos os
IDs/papéis devem conferir e todos os e-mails reservados devem estar verificados.
Uma conta ausente ou não verificada aborta o lote inteiro. Não altera papéis,
proprietários ou IDs; reaplicação não sobrescreve vínculos existentes.

```bash
python3 scripts/neon-migration.py reserve-logins-staging \
  --mapping /caminho/privado/contas.json \
  --project floral-pond-94925356 --branch br-empty-water-b5nntdyc
python3 scripts/neon-migration.py bind-accounts-staging \
  --mapping /caminho/privado/contas.json \
  --project floral-pond-94925356 --branch br-empty-water-b5nntdyc
```

As duas reservas do ensaio já existem; não repetir o primeiro comando sobre elas.
Esses comandos não criam usuários de autenticação, escolhem senhas ou enviam e-mails.
O atalho de login `visualizador` usa `VITE_VIEWER_LOGIN_EMAIL` quando configurado;
esse valor fica público no bundle. Sem o atalho, entrar com o e-mail da conta.

## Credenciais e rede

Os scripts usam somente os segredos do ambiente:

- `SUPABASE_ACCESS_TOKEN`, destinado a `api.supabase.com`.
- `NEON_API_KEY`, destinado a `console.neon.tech`.

A conexão SQL é obtida pela API oficial do Neon e usada apenas em memória, por
HTTPS com verificação TLS ativa. Não imprimir a URI nem colocá-la no frontend.
O host SQL deve ser permitido na política de rede. Para a branch de ensaio:

```text
ep-bold-recipe-b52pk8w6.c-7.us-east-2.aws.neon.tech
```

Os serviços geraram também hosts `neonauth` e `apirest` no mesmo endpoint. A
validação sintética usa o endpoint `ep-fragrant-mode-b5ndtw8t`, com hosts SQL,
Auth e Data API próprios. Os cinco hosts adicionais foram salvos no rascunho do
ambiente. As chamadas HTTPS reais passaram, embora a observação do painel tenha
retornado estado `unknown`; não presumir que um rascunho salvo foi publicado.
Publicar o ambiente de desenvolvimento é distinto de fazer deploy da aplicação.

As variáveis públicas `VITE_NEON_AUTH_URL` e `VITE_NEON_DATA_API_URL` são lidas no
build. No Neon Auth, permitir explicitamente a origem usada pela aplicação. Para
o desenvolvimento validado, usar `http://localhost:5173`; `127.0.0.1` não equivale
a `localhost` para a validação de origem. A origem de produção precisa de whitelist
no destino final antes do corte. Não distribuir endpoints de fixtures em produção.

## Backup lógico privado

Na raiz do checkout:

```bash
python3 scripts/neon-migration.py backup \
  --source-project llftfgtswvmwtbmkegpd \
  --output /workspace/.migration-private/backup-novo
```

O diretório deve estar fora do Git, com permissão 0700. O comando cria um novo
snapshot 0600 e manifesto com SHA-256, contagens e instante da exportação. Não
sobrescreve arquivos existentes. As quatro tabelas e as contas são lidas em uma
única consulta, com um snapshot PostgreSQL consistente.

O snapshot inclui dados pessoais e hashes de senha: mantenha-o privado. Ele é um
backup lógico limitado ao domínio da aplicação e às contas; não é dump completo
do projeto Supabase. Arquivos neste ambiente também não substituem uma cópia
durável em armazenamento privado aprovado antes da troca de produção.

```bash
python3 scripts/neon-migration.py verify-backup \
  --snapshot /workspace/.migration-private/backup-novo/source_snapshot.json
```

A verificação confere checksum, presença das tabelas, chaves, proprietários e
vínculos. Duplicidades e campos novos exigem conciliação explícita; não são
descartados nem corrigidos silenciosamente.

## Ensaio local da restauração

```bash
node scripts/rehearse-neon-backup.mjs \
  /workspace/.migration-private/backup-novo/source_snapshot.json
```

O ensaio usa PostgreSQL via PGlite em memória, sem enviar dados à rede. Aplica o
mesmo SQL e plano de importação da restauração remota e compara o conteúdo de
cada tabela no próprio banco. O subject autenticado é simulado somente nesse
harness; isso não testa Neon Auth, JWT real ou o serviço remoto.

## Restauração no Neon de ensaio

Pré-requisitos: branch vazia, rede liberada e Neon Auth/Data API habilitados sem
grants amplos automáticos. O executor verifica o helper oficial e o esquema de
login antes da cópia. As identidades e senhas podem ser ativadas depois; contas
sem vínculo permanecem sem acesso. Nunca importar sobre dados a mesclar.

```bash
python3 scripts/neon-migration.py restore-staging \
  --snapshot /workspace/.migration-private/backup-novo/source_snapshot.json \
  --project floral-pond-94925356 \
  --branch br-empty-water-b5nntdyc
```

O executor confirma o destino pela API, obtém a conexão sem exibi-la e executa
esquema, permissões, contas, dados, comparações e manifesto numa transação
serializável. Uma divergência de conteúdo aborta tudo. Reaplicação sobre esquema
existente falha; não há DROP, TRUNCATE, UPSERT ou limpeza automática. Após a
transação, o executor atualiza o cache do Data API. Se só essa atualização falhar,
a cópia já está confirmada: atualizar o cache, sem reaplicar a importação.

As contas importadas ficam sem subject até a vinculação administrativa com as
identidades do novo provedor. Restauração de tabelas não equivale a login migrado.
Os testes por API real devem cobrir os quatro perfis: proprietário, visualizador,
outro usuário e anônimo, utilizando contas/dados sintéticos em ambiente separado.

## Testes

```bash
corepack pnpm test:migration
corepack pnpm lint
corepack pnpm exec tsc --noEmit --incremental false
corepack pnpm build
```

Os testes de migração usam apenas fixtures sintéticas. Exercitam o plano real de
restauração, RLS, vínculo entre IDs novos/antigos, conta desativada, FKs compostas,
rollback, tentativa de reaplicação, checksum e proteção dos arquivos. Falhas de
lint/tipos já existentes devem ser reportadas separadamente das regressões novas.

## Passagem para produção, após revisão

1. Concluir login, API, cadastro e transição das contas sem perder seus vínculos.
2. Validar banco remoto, E2E e regressão web/Android; não usar pacientes como fixtures.
3. Preparar backup privado durável e verificar o procedimento de recuperação.
4. Definir uma janela de corte e impedir que escritas ocorridas depois do snapshot
   sejam perdidas: novo snapshot/delta validado antes da ativação.
5. Apresentar diff, SQL, resultados, pendências e procedimento de compensação.
6. Somente após autorização, importar no destino final e ativar os novos endpoints.
7. Preservar Supabase e deployment anterior durante a validação. Rollback do
   frontend não desfaz escritas novas no Neon; reconciliação reversa é procedimento
   próprio, sem sobrescrever dados silenciosamente.
