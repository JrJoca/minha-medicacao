# Login no Android — configuração segura do ambiente

Revisão: 19/11/2026. **Este documento não contém senhas, tokens ou dados de usuários.**

## Causa identificada no APK do PR #9 (primeiro build)

O GitHub Actions gerava o frontend Android sem as variáveis públicas
`VITE_NEON_AUTH_URL` e `VITE_NEON_DATA_API_URL`. Como o código
`lib/neon.ts` exige ambas ao criar o cliente, o login não tinha backend
disponível no APK, mesmo com contas e senhas válidas.

Além disso, Neon Auth só aceitava os domínios web aprovados, e o
Capacitor usa `https://localhost` para os recursos locais no Android 8.
Essa origem precisava estar explicitamente autorizada.

## Correções

1. A allowlist **da branch de produção** do Neon Auth inclui somente
   `https://localhost` além dos domínios web existentes. A opção global
   `allow_localhost` continua **desativada**. Não se alteraram RLS,
   senhas, métodos de autenticação ou contas.
2. O job `apk-debug` do GitHub Actions recebe as URLs **públicas**
   de Auth e Data API da branch de produção. A etapa de CI falha se elas
   não aparecerem nos assets compilados do Android.
3. `capacitor.config.ts` fixa a origem virtual em
   `https://localhost` (hostname `localhost`, esquema `https`).
4. A variante debug utiliza o sufixo de pacote `.teste` e o nome
   **Minha Medicação (Teste)**. Isso evita substituir o aplicativo
   antigo assinado por outra chave de desenvolvimento.

## Verificação do novo APK

No GitHub Actions do PR #9, confirmar:

- `pnpm android:sync` concluiu;
- validação dos endpoints do Neon no bundle Android concluiu;
- `bash ./gradlew assembleDebug` concluiu;
- APK e SHA-256 foram publicados como pré-release.

Em um Android com internet, instalar **Minha Medicação (Teste)** e
entrar com **e-mail e senha do Neon Auth já vinculados**. A conta
`visualizador` por apelido só funciona se a variável pública opcional
`VITE_VIEWER_LOGIN_EMAIL` estiver configurada; usar seu e-mail é
a alternativa. Contas com e-mail não verificado precisam confirmar o
código. Não usar credenciais administrativas ou de banco no celular.

Testar login, logout, reabertura, consumo/estoque em modo somente
leitura, e notificações. Não criar tomadas médicas fictícias em
produção.

Se o login continuar falhando, registrar a **mensagem exata exibida**
e a versão do Android (sem enviar senha, token, JWT ou captura contendo
dados sensíveis). Diferenciar: erro de rede, origem inválida, senha,
e-mail não verificado e sessão não persistida.

**Importante:** as mudanças corrigem a configuração conhecida, mas
não substituem teste real em WebView. Não declarar autenticação
validada no dispositivo sem prova de login e restauração de sessão.

## Segurança e limitações

- `https://localhost` é a origem da WebView local do Capacitor,
  não é um servidor externo expondo dados clínicos.
- URLs `VITE_*` são públicas por natureza. Nunca colocar
  `NEON_API_KEY`, conexão PostgreSQL, senha, tokens ou secrets no APK.
- RLS continua isolando proprietário/visualizador; nenhum dado médico
  foi modificado por este ajuste.
- A variante de teste pode coexistir com um APK antigo. Caso o antigo
  continue ativo, ambos podem emitir notificações; durante testes,
  desabilitar notificações do APK antigo nas configurações do Android.
