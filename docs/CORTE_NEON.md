# Corte para Neon

O corte autorizado foi concluído em 22/10/2026 (UTC). A aplicação publicada em
https://minha-medicacao.vercel.app usa Neon Auth, Data API e banco Neon. O Supabase
permanece preservado, com escritas bloqueadas somente nas quatro tabelas migradas.

## Estado atual

- Snapshot final consistente criado após a barreira e validado em diretório privado, fora do Git:
  7 medicamentos, 2 rotinas, 7 vínculos, 2 tomadas e 2 contas.
- PR #1 integrado à `master`; commit de ativação
  `fb14c7f156d9ee356ce6ff6a6072110f550ab678`.
- Destino autorizado: projeto `floral-pond-94925356`, branch padrão
  `br-muddy-term-b5xvw6i7`, banco `neondb`.
- O schema de destino estava vazio antes do provisionamento. Neon Auth e Data API
  foram habilitados sem grants amplos.
- Auth exige verificação OTP e mantém localhost desabilitado. As duas pessoas
  definiram suas senhas e confirmaram os e-mails pela prévia. Ambas as identidades
  já estão vinculadas aos IDs antigos, mantendo papéis e proprietário do visualizador.
  Na ativação, as escritas e o cadastro de novo escopo foram liberados sob RLS.
- A cópia no destino final já foi comparada exatamente e o backup remoto completo
  foi recuperado e conferido: SHA-256, contagens e integridade passaram.
- Estado do destino: `active`, 2 contas de origem, 2 vínculos de login e 2
  contas reservadas verificadas; permissões de escrita protegidas pelo RLS.
- Barreira na origem confirmada desde `2026-10-22 02:03:01.283742+00`.
- Snapshot final SHA-256:
  `46d29cdd81cecc764d152dd233437e25c076c5c43c10ca2374fbae507891484e`.
- Deploy Vercel Production confirmado pelo GitHub, ID `7241870915`.
  HTML e scripts públicos conferidos para usar exclusivamente os endpoints finais.
  PR integrado: https://github.com/JrJoca/minha-medicacao/pull/1 .
- Prévia de ativação: https://minha-medicacao-rn7j18rgx-jrjocas-projects.vercel.app .
  Sua origem e a origem de produção estão permitidas no Neon Auth.
- O acesso ao SQL de produção e à API GitHub foi liberado e confirmado por
  requisições reais. O domínio de prévia, descoberto depois do build da Vercel,
  também já respondeu: HTTP 302 para login na Vercel. Sua inclusão está salva
  no rascunho; salvar e publicar o ambiente persiste a configuração.
- A prévia usa proteção de acesso Vercel. Cada acesso precisa ser autorizado
  na Vercel antes de chegar ao formulário da aplicação; isso não é uma falha
  de login Neon nem motivo para compartilhar senhas ou tokens no chat.

## Mudanças do ambiente Codex

Preservar os domínios/segredos existentes e adicionar:

```text
api.github.com
ep-late-water-b53akznr.c-7.us-east-2.aws.neon.tech
ep-late-water-b53akznr.neonauth.c-7.us-east-2.aws.neon.tech
ep-late-water-b53akznr.apirest.c-7.us-east-2.aws.neon.tech
minha-medicacao.vercel.app
minha-medicacao-rn7j18rgx-jrjocas-projects.vercel.app
```

Os domínios já estão no rascunho. As variáveis VITE de desenvolvimento continuam
apontando para ensaio. Não é necessário substituir as credenciais existentes
nesta etapa. Um rascunho salvo ainda não comprova liberação aplicada.

## Build e publicação

`vercel.json` configura build estático em `dist/client`. O script
`scripts/build-neon-deployment.mjs` injeta somente as URLs públicas do destino
revisado em `deploy/neon-production.json`, sobrepondo URLs locais de ensaio.
`pnpm build` continua disponível para desenvolvimento; o build de deploy usa:

```bash
node scripts/build-neon-deployment.mjs
```

As URLs não contêm senhas, tokens ou conexão PostgreSQL. Chaves administrativas
não são necessárias no frontend nem na Vercel para o runtime. Conferir o deploy
de preview e sua origem permitida antes de promover a versão para produção.

## Preparação transacional do banco final

O novo executor é separado do executor de ensaio, que continua recusando produção.
`scripts/neon-cutover.py` exige flag de execução intencional, destino exato,
metadados da branch padrão, conexão do endpoint/banco esperado e destino vazio.

```bash
python3 scripts/neon-cutover.py prepare --production-authorized \
  --snapshot /caminho/privado/source_snapshot.json \
  --mapping /caminho/privado/account_transition.json
```

O plano preserva os dados por comparação exata, reserva os e-mails aprovados e
guarda uma cópia completa dos bytes do backup em
`application_private.source_backups`. Esse arquivo remoto inclui dados pessoais
e hashes antigos para recuperação; não é importação de senhas no Neon Auth.
O checksum é imposto pelo próprio banco. O backup e o controle de corte ficam
fora dos schemas expostos pela API, sem grants a clientes e com RLS habilitado.

Após o commit, o executor lê o backup remoto e confere SHA-256, conteúdo e
contagens, comprovando recuperação sem depender da cópia local. Essa verificação
já foi concluída na execução real no destino em 22/10/2026.

A preparação revoga escritas nos quatro recursos e o cadastro de escopo pelo
Data API. Nenhum subject é vinculado nessa fase. Isso permite preparar as contas
sem abrir dois bancos para alterações simultâneas. Não repetir a importação em
caso de falha posterior ao commit: consultar estado e verificar o backup.

```bash
python3 scripts/neon-cutover.py status --production-authorized
python3 scripts/neon-cutover.py verify-archive --production-authorized --sha256 SHA_DO_MANIFESTO
```

## Registro das etapas do corte

As duas pessoas concluíram a confirmação de e-mail e a consulta canônica confirmou
ambas as reservas verificadas. A barreira, finalização, vínculo, deploy e ativação
foram executados com sucesso. Não repetir `prepare`, `finalize` ou `activate`.

1. [x] Confirmar GitHub, SQL final e conexão com a prévia. [ ] Persistir/publicar
   o rascunho completo de rede e acessar a prévia com login Vercel.
2. [x] Preparar o banco, verificar backup remoto e manter escritas fechadas.
3. [x] Publicar preview, permitir sua origem exata e habilitar cadastro para a ativação.
   As duas pessoas escolhem suas novas senhas e confirmam os e-mails. Não informar
   senhas/códigos no chat. As contas ficam sem acesso aos dados até a ligação final.
4. [x] Confirmar as duas identidades verificadas, o deploy pronto e a recuperação do
   backup antes de iniciar a janela de indisponibilidade de escritas.
5. [x] Bloquear escritas apenas nas quatro tabelas da aplicação na origem; registrar
   e testar a reversão. Não alterar `public.links` nem interromper Auth de outros usos.
6. [x] Obter snapshot final após o bloqueio e reconciliar mudanças desde a preparação.
   Validar cada conteúdo/ID/vínculo. Não executar uma nova importação inicial nem
   sobrescrever cópias existentes sem comparação do estado esperado.
7. [x] Atualizar o backup remoto com o snapshot final, vincular identidades e conferir
   papéis. Habilitar as permissões de escrita no Neon em transação e ativar o frontend.
8. [x] O usuário confirmou o acesso das duas contas, dados e permissões em produção.
   A verificação administrativa das identidades/vínculos também passou.
   Web pública: HTTP 200, hidratação, formulários e zero pageerrors.
9. [ ] Atualização do APK, sua origem no Auth e notificações em dispositivo ficam
   como última etapa, após as funcionalidades web de estoque. PHP opcional segue
   pendente de validação quando utilizado. Usar a web e manter Supabase preservado.

Se qualquer pré-requisito faltar, manter a origem operante e o destino fechado
para escrita. `freeze-source` instala triggers transacionais somente nas quatro
tabelas da aplicação e aguarda escritores anteriores. Leituras continuam
disponíveis; Auth e outros recursos não são alterados. `unfreeze-source` testa
que o Neon ainda está preparado e sem grants de escrita antes de remover a barreira.

Depois da barreira, gerar outro backup com `neon-migration.py backup`. `finalize`
exige snapshot posterior à barreira, cópia inicial exatamente intacta, mesmos
IDs/papéis/vínculos de contas e ambas as identidades verificadas. Reconcilia os
quatro recursos em transação, compara todos os campos, conserva ambos os backups
privados no destino e vincula os logins; mantém escritas revogadas.

`activate` confere a barreira, o snapshot final intacto, todos os vínculos
verificados, a master e o deploy GitHub Production concluído no SHA informado.
Também busca o HTML e os scripts da URL pública para verificar os dois endpoints
Neon finais. Só então concede escritas em transação, preservando o RLS existente.
O frontend é publicado separadamente pela integração GitHub/Vercel.

```bash
python3 scripts/neon-cutover.py freeze-source --production-authorized --mapping /privado/account_transition.json
python3 scripts/neon-migration.py backup --source-project llftfgtswvmwtbmkegpd --output /privado/final
python3 scripts/neon-cutover.py finalize --production-authorized \
  --previous-snapshot /privado/inicial/source_snapshot.json \
  --snapshot /privado/final/source_snapshot.json --mapping /privado/account_transition.json
# Após o merge/deploy de produção:
python3 scripts/neon-cutover.py activate --production-authorized \
  --sha256 SHA_FINAL --deployment-commit COMMIT_PUBLICADO
```

## Recuperação

Antes de habilitar escritas no Neon, é possível abortar a ativação e continuar no
deployment/Supabase anteriores; restaurar qualquer bloqueio temporário da origem
segundo o registro feito na janela. Não apagar o destino nem os backups.

Depois de novas escritas no Neon, não basta voltar o frontend. Preservar/exportar
as alterações novas, bloquear novas mutações durante a análise e reconciliar os
dois lados antes de reabrir uma origem antiga. Não perder tomadas ou históricos
criados depois do corte.

## Validação da preparação

50 testes aprovados, instalação congelada, TypeScript e build de deploy passaram.
Lint passou com um aviso de imagem já existente. O bundle foi conferido para
conter somente os endpoints do Neon final, sem hosts de fixtures/ensaio/Supabase.
A preparação e a recuperação do backup foram executadas contra o destino real.
A sincronização final e a ativação também foram executadas, com a origem bloqueada,
backup final recuperado e verificação dos endpoints da aplicação pública.
