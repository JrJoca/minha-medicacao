# Minha Medicação

Sistema web responsivo para cadastrar medicamentos, organizar rotinas e acompanhar diariamente os registros de medicação.

## Funcionalidades

- Cadastro de medicamentos com nome, dosagem e link de referência.
- Criação de rotinas usando medicamentos previamente cadastrados.
- Período configurável em dias ou semanas e opção sem data para terminar.
- Definição de horário previsto e horário limite.
- Pausar, editar e excluir rotinas.
- Registro individual como tomado ou não tomado.
- Alteração da data, horário e status de registros anteriores.
- Contador de progresso, como **Dia 1/30**.
- Relatório diário com medicamentos, dosagens, horários e pendências.
- Compartilhamento da conclusão pelo WhatsApp com mensagem preenchida.
- Importação em massa por OCR de receitas digitadas.
- Notificações locais na versão Android.
- Interface responsiva inspirada no Material Design.

## Tecnologias

- React 19, TypeScript, Vinext e Vite
- Tailwind CSS
- Neon PostgreSQL, Neon Auth e Data API
- Tesseract.js
- Capacitor para Android
- PHP como integração opcional de backend
- Vercel para hospedagem web

## Requisitos

- Node.js >=22.13
- pnpm 11.25.0 (via Corepack)
- Git
- Branch Neon de desenvolvimento com Auth, Data API e migrações configurados

Para gerar o aplicativo Android, também são necessários Android Studio, Android SDK e Java/JDK compatível com o Gradle do projeto.

## Instalação

```bash
git clone https://github.com/JrJoca/minha-medicacao.git
cd minha-medicacao
pnpm install
pnpm dev
```

## Build de produção

```bash
pnpm build
```

Os arquivos estáticos são gerados em `dist/client`.

## Configuração do Neon

A [aplicação publicada](https://minha-medicacao.vercel.app) usa Neon para banco,
autenticação e API. O corte autorizado preservou os dados e vinculou as duas
contas antigas aos novos logins. Consulte o estado e a recuperação em
[docs/CORTE_NEON.md](docs/CORTE_NEON.md). Não repetir a importação inicial.

Consulte a [revisão e os testes](docs/VALIDACAO_NEON.md) e a
[sequência de implementação do estoque](docs/PLANO_ESTOQUE.md).

A [base de estoque](docs/ESTOQUE_BASE.md) amplia o banco para total de comprimidos,
comprimidos por caixa, consumo diário e duração calculada. O cadastro atual do
medicamento permanece igual; a configuração pela interface será uma etapa posterior.

Para desenvolver, configure um arquivo local `.env.local` (ignorado pelo Git):

```dotenv
VITE_NEON_AUTH_URL=https://SEU_HOST_DE_AUTH/neondb/auth
VITE_NEON_DATA_API_URL=https://SEU_HOST_DE_API/neondb/rest/v1
# Opcional: mantém o atalho de login "visualizador". Este valor fica público no bundle.
# VITE_VIEWER_LOGIN_EMAIL=email-da-conta-visualizadora
```

O frontend usa somente URLs públicas. Senhas de banco, `NEON_API_KEY` e
`SUPABASE_ACCESS_TOKEN` pertencem exclusivamente às ferramentas administrativas.
No Neon, habilite Auth e Data API sem grants amplos antes de importar o esquema.
O cadastro verifica o e-mail por código; a recuperação de senha também usa código.

O frontend consulta diretamente o Data API. A integração PHP opcional usa
`NEON_DATA_API_URL` no servidor e repassa o JWT do usuário. Ela não usa chave administrativa.

## Publicação na Vercel

| Campo | Valor |
|---|---|
| Framework Preset | Other |
| Root Directory | vazio |
| Install Command | `pnpm install` |
| Build Command | `pnpm build` |
| Output Directory | `dist/client` |
| Node.js Version | `22.x` |
| Production Branch | `master` |

Versão em produção: [https://minha-medicacao.vercel.app](https://minha-medicacao.vercel.app)

Novos commits enviados para a branch `master` geram automaticamente um novo deployment.
As variáveis `VITE_NEON_AUTH_URL` e `VITE_NEON_DATA_API_URL` são incorporadas no
build; devem corresponder ao ambiente escolhido. Não apontar produção para a
branch de fixtures. A mudança exige novo build web e nova sincronização Android.

## Android

```bash
pnpm android:sync
pnpm android:open
pnpm android:apk:debug
```

Consulte também [ANDROID_BUILD.md](ANDROID_BUILD.md) e [GUIA_ANDROID_WINDOWS.md](GUIA_ANDROID_WINDOWS.md).

## Estrutura principal

```text
app/                    Interface e páginas da aplicação
components/             Componentes visuais
lib/                    Neon, OCR e notificações
public/                 Arquivos públicos
neon/migrations/        Estrutura, vínculos de contas e RLS no Neon
supabase/migrations/    Histórico da estrutura de origem (preservado)
api/                    Integração opcional em PHP
android/                Projeto Android do Capacitor
scripts/                Scripts de instalação e build
```

## OCR de receitas

O leitor utiliza Tesseract.js e foi preparado para receitas digitadas. Depois do processamento, os medicamentos identificados são apresentados em campos editáveis antes da inclusão em massa.

A leitura pode exigir revisão manual porque a qualidade depende da resolução, iluminação, contraste e formatação da receita.

## WhatsApp

O sistema monta uma mensagem com os dados da rotina e abre o WhatsApp. O envio não é automático: o usuário revisa a mensagem e toca em **Enviar**.

## Observação

Este sistema auxilia na organização pessoal das rotinas de medicação. Ele não substitui receita, orientação médica ou acompanhamento profissional.
