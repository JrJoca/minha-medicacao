# Corte para Neon

O usuário autorizou iniciar o corte em 22/10/2026. A aplicação publicada continua
no Supabase enquanto os pré-requisitos abaixo são concluídos. Não há congelamento
da origem neste momento.

## Estado atual

- Novo backup consistente criado e validado em diretório privado, fora do Git:
  7 medicamentos, 2 rotinas, 7 vínculos, 2 tomadas e 2 contas.
- `master` remota segue em `fca5b13d6b317182d64b0a97eb7f75e94670d1b6` na conferência.
- Destino autorizado: projeto `floral-pond-94925356`, branch padrão
  `br-muddy-term-b5xvw6i7`, banco `neondb`.
- O schema de destino estava vazio antes do provisionamento. Neon Auth e Data API
  foram habilitados sem grants amplos; nenhuma conta real foi criada.
- Auth exige verificação OTP, mantém cadastro fechado e localhost desabilitado.
  A origem `https://minha-medicacao.vercel.app` está permitida.
- O acesso HTTP ao SQL de produção e à API GitHub recebeu CONNECT 403. As
  liberações estão salvas no rascunho; exigem revisão, salvamento e publicação do
  ambiente para aplicar a política. Não se atribui esse erro às credenciais.

## Mudanças do ambiente Codex

Preservar os domínios/segredos existentes e adicionar:

```text
api.github.com
ep-late-water-b53akznr.c-7.us-east-2.aws.neon.tech
ep-late-water-b53akznr.neonauth.c-7.us-east-2.aws.neon.tech
ep-late-water-b53akznr.apirest.c-7.us-east-2.aws.neon.tech
minha-medicacao.vercel.app
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
só poderá ser declarada concluída depois da execução real no destino.

A preparação revoga escritas nos quatro recursos e o cadastro de escopo pelo
Data API. Nenhum subject é vinculado nessa fase. Isso permite preparar as contas
sem abrir dois bancos para alterações simultâneas. Não repetir a importação em
caso de falha posterior ao commit: consultar estado e verificar o backup.

```bash
python3 scripts/neon-cutover.py status --production-authorized
python3 scripts/neon-cutover.py verify-archive --production-authorized --sha256 SHA_DO_MANIFESTO
```

## Sequência restante e condições do corte

1. Aplicar a rede e confirmar os acessos reais ao GitHub e ao SQL final.
2. Executar a preparação acima; verificar o backup remoto, RLS e escritas fechadas.
3. Publicar preview, permitir sua origem exata e habilitar cadastro para a ativação.
   As duas pessoas escolhem suas novas senhas e confirmam os e-mails. Não informar
   senhas/códigos no chat. As contas ficam sem acesso aos dados até a ligação final.
4. Confirmar as duas identidades verificadas, o deploy pronto e a recuperação do
   backup antes de iniciar a janela de indisponibilidade de escritas.
5. Bloquear escritas apenas nas quatro tabelas da aplicação na origem; registrar
   e testar a reversão. Não alterar `public.links` nem interromper Auth de outros usos.
6. Obter snapshot final após o bloqueio e reconciliar mudanças desde a preparação.
   Validar cada conteúdo/ID/vínculo. Não executar uma nova importação inicial nem
   sobrescrever cópias existentes sem comparação do estado esperado.
7. Atualizar o backup remoto com o snapshot final, vincular identidades e conferir
   papéis. Habilitar as permissões de escrita no Neon em transação e ativar o frontend.
8. Validar as duas contas reais, entrega dos códigos, web/Android e integrações.
   Manter Supabase preservado durante a observação.

Se qualquer pré-requisito faltar, manter a origem operante e o destino fechado
para escrita. Este preparador não bloqueia a origem, não sincroniza deltas, não
vincula as contas e não publica a aplicação; esses passos precisam das evidências
acima antes da execução.

## Recuperação

Antes de habilitar escritas no Neon, é possível abortar a ativação e continuar no
deployment/Supabase anteriores; restaurar qualquer bloqueio temporário da origem
segundo o registro feito na janela. Não apagar o destino nem os backups.

Depois de novas escritas no Neon, não basta voltar o frontend. Preservar/exportar
as alterações novas, bloquear novas mutações durante a análise e reconciliar os
dois lados antes de reabrir uma origem antiga. Não perder tomadas ou históricos
criados depois do corte.
