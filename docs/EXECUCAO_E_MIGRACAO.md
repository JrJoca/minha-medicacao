# Execução e migração para o Codex

## O que esta transição muda
Muda o local de desenvolvimento e dá ao Codex contexto versionado. Não requer novo Supabase, outro domínio ou novo deploy. Continuar com o repositório e os serviços atuais.

## Preparação no computador/Codex
1. Instalar Git e Node 22.x, versão >=22.13.0.
2. Disponibilizar exatamente pnpm 11.25.0, indicado em packageManager. Pode ser via Corepack, se disponível no computador, ou instalação aprovada do pnpm.
3. Clonar o GitHub e selecionar a branch de preparação indicada na entrega. A documentação não estará em master enquanto não houver merge autorizado.
4. Abrir essa pasta no Codex; ler AGENTS.md e docs/CODEX_HANDOFF.md.
5. Conferir alterações locais com git status e não sobrescrever trabalho de outra máquina.
6. Configurar ambiente de testes separado antes de executar cenários de cadastro/alteração.

Comandos, substituindo BRANCH_DE_PREPARACAO pelo nome informado na entrega:

```bash
git clone https://github.com/JrJoca/minha-medicacao.git
cd minha-medicacao
git fetch origin
git switch --track origin/BRANCH_DE_PREPARACAO
pnpm --version
node --version
pnpm install --frozen-lockfile
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm dev
```

O pnpm dev usa porta 5173 no perfil portable. Em clone novo, scripts/execution-profile.mjs seleciona portable na ausência do arquivo local de perfil. Não copiar .sites-runtime de outro ambiente. O perfil managed-linux tem wrappers próprios do Sites.

Não foi possível executar esses comandos nesta sessão por falta de ambiente. Resultados esperados são critérios de verificação, não testes concluídos.

## Supabase e variáveis
- A conexão do frontend atual está literal em lib/supabase.ts. Um .env isolado não a substitui.
- Para testar com escrita, configurar explicitamente a conexão para o projeto de desenvolvimento em branch de trabalho; não publicar essa alteração por acidente.
- Não exportar service_role para React, Vite, NEXT_PUBLIC_* ou VITE_*.
- Configuração PHP opcional: SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no servidor; criar api/config.php privado a partir do exemplo. Configurar PHP com cURL em hospedagem compatível.
- A Vercel está servindo saída estática; não assumir que /api/routines.php será executado.
- Não mudar para Next build ou outro output sem tarefa de migração específica: o script atual usa Vinext.

## Conexões necessárias
- GitHub: acesso ao repositório para ler/criar branch/PR; permissões administrativas só se uma tarefa as exigir.
- Vercel: acesso ao projeto para consultar logs/deployments; publicar apenas quando solicitado.
- Supabase: acesso ao projeto de teste para validação; acesso de produção deve ser usado com cuidado e escopo mínimo.
- Essas conexões precisam existir na instalação do Codex usada pelo usuário; não são transferidas por copiar o código.
- Tokens temporários, cookies, JWTs e conexões desta conversa não integram o pacote de memória.

## Android
- Projeto existente em android; appId br.com.joaquimkurama.minhamedicacao.
- webDir dist/client, arquivos embarcados; não é um mero link remoto da Vercel.
- compileSdk/targetSdk 36, minSdk 24; instalar Android SDK 36 e JDK compatível com o Gradle do projeto.
- Guias existentes: ANDROID_BUILD.md e GUIA_ANDROID_WINDOWS.md.
- macOS/Linux: pnpm android:sync; pnpm android:open; pnpm android:apk:debug.
- O script android:apk:debug usa ./gradlew. No Windows, depois de pnpm android:sync, executar gradlew.bat assembleDebug dentro de android ou usar Android Studio.
- APK debug esperado: android/app/build/outputs/apk/debug/app-debug.apk.
- AAB/APK release deve ser assinado com a chave original preservada fora do Git. Sem ela, pode não ser possível atualizar uma instalação assinada anterior.
- Antes de nova release aumentar versionCode/versionName, sincronizar build e testar no aparelho.
- Android depende de permissões de notificação/alarme e restrições de bateria. Não prometer entrega exata sem teste no aparelho.

## Passagem segura para produção — futura, mediante pedido
1. Validar todos os testes locais e usar preview com backend de teste.
2. Revisar diff, dependências, segredos e eventuais migrações.
3. Fazer backup quando houver alteração de estrutura/dados; identificar último deployment pronto para rollback.
4. Obter pedido explícito para merge/push/publicação. master pode disparar publicação automática.
5. Confirmar SHA do deployment READY e domínio público, depois testar fluxos permitidos.
6. Em regressão, promover deployment anterior pela Vercel; mudança de banco exige plano próprio, não é revertida só por voltar o frontend.
