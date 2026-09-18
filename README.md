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
- Supabase
- Tesseract.js
- Capacitor para Android
- PHP como integração opcional de backend
- Vercel para hospedagem web

## Requisitos

- Node.js 22 ou superior
- pnpm 11 ou superior
- Git
- Projeto configurado no Supabase

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

## Configuração do Supabase

A estrutura do banco está disponível em:

```text
supabase/migrations/202609150001_medication_control.sql
```

Execute essa migração no SQL Editor do projeto Supabase antes de utilizar o sistema.

A aplicação utiliza uma chave pública do Supabase no frontend. Nunca exponha uma chave `service_role` ou qualquer chave secreta no código do navegador.

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
lib/                    Supabase, OCR e notificações
public/                 Arquivos públicos
supabase/migrations/    Estrutura do banco de dados
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
