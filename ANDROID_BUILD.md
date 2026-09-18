# Android — Minha medicação

## Requisitos

- Node.js 22 ou superior
- pnpm
- Android Studio 2025.2.1 ou superior
- Android SDK 36

## Sincronizar o aplicativo

```bash
pnpm android:sync
```

Esse comando gera o build web e copia os arquivos para o projeto Android.

## Abrir no Android Studio

```bash
pnpm android:open
```

No Android Studio, aguarde a sincronização do Gradle e execute em um aparelho
ou emulador Android.

## Gerar APK de teste

```bash
pnpm android:apk:debug
```

O arquivo será criado em:

`android/app/build/outputs/apk/debug/app-debug.apk`

## Gerar versão assinada

Use **Build > Generate Signed Bundle / APK** no Android Studio. A chave de
assinatura não deve ser adicionada ao repositório. Para publicar na Play Store,
gere um Android App Bundle (`.aab`).

## Atualizações

1. Faça as alterações no código React compartilhado.
2. Valide o build web.
3. Execute `pnpm android:sync`.
4. Teste no Android.
5. Gere um novo APK ou AAB com número de versão atualizado.

O aplicativo Android e a versão web usam o mesmo projeto Supabase.
