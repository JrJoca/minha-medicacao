# Arquitetura — Minha medicação

Atualizada em 19/10/2026. O texto anterior que descrevia uma prévia exclusivamente demonstrativa está desatualizado em relação à base atual.

## Fluxo efetivo
A interface React usa Supabase Auth e o cliente supabase-js diretamente para ler/gravar nas tabelas protegidas por RLS. A Vercel hospeda os arquivos web gerados em dist/client. O APK Capacitor empacota esses arquivos e acessa o mesmo backend, se configurado com a mesma URL.

A API PHP em api/routines.php é uma alternativa de proxy para medication_routines. O fluxo principal em app/page.tsx não a chama. Não há evidência de runtime PHP habilitado na publicação estática da Vercel; arquivos PHP exigem hospedagem própria com PHP/cURL ou adaptação explicitamente aprovada.

## Stack verificada
- React 19.2.6 e TypeScript 5.9.3.
- Vinext 1.0.0-beta.5, Vite 8.0.13; dependência Next 16.3.4. Não assumir aplicação Next convencional: os scripts reais chamam Vinext/Vite.
- Tailwind CSS 4.2.1 e componentes shadcn/Radix/Base UI.
- Supabase JS 2.116.0, Auth e Postgres/RLS.
- Tesseract.js 6.0.1, reconhecimento em português no cliente.
- Capacitor Android/Core/CLI 8.5.1; notificações locais 8.3.0.
- pnpm 11.25.0, definido em packageManager; Node >=22.13.0.

## Mapa
| Local | Responsabilidade |
|---|---|
| app/page.tsx | Autenticação, medicamentos, rotinas, relatórios, OCR, WhatsApp e estados da página |
| app/globals.css | Estilos globais |
| app/layout.tsx | Metadados e idioma pt-BR |
| components/ui | Componentes visuais reutilizáveis |
| lib/supabase.ts | Cliente Supabase; URL e chave publishable atualmente literais |
| lib/prescription-ocr.ts | OCR e extração heurística de rascunhos |
| lib/native-notifications.ts | Agendamento local de lembrete e prazo no Android |
| api | Proxy PHP opcional e configuração de exemplo |
| supabase/migrations | Migração inicial das quatro tabelas de medicação |
| 202609180001_viewer_read_only.sql | Políticas do visualizador; arquivo fora da pasta de migrations |
| capacitor.config.ts e android | Empacotamento Android |
| scripts | Instalação e execução portable/managed-linux |
| vite.config.ts, build | Integração Vinext, Sites e bindings Cloudflare |
| examples/d1 | Exemplo do scaffold; não é a base de dados médica |
| .openai/hosting.json | Vínculo do Site existente e diretório estático |

## Configuração e armazenamento
- lib/supabase.ts não lê variáveis de ambiente hoje. Apenas criar um .env não muda a conexão.
- A chave publishable é própria para exposição pública; não copiar chaves secretas para o navegador.
- Se futuramente externalizar URL/chave, definir convenção compatível com Vinext/Vite, alterar o cliente e validar web/APK. Isso não foi feito nesta preparação.
- PHP lê SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY de api/config.php baseado no exemplo. Configuração real fica fora do Git.
- Sessão Supabase persiste no cliente com renovação automática.
- Número do WhatsApp e preferência de incluir nomes ficam no localStorage por dispositivo; não no Supabase.
- Receita é processada no cliente. Tesseract pode baixar worker/modelos pela rede; testar disponibilização e CSP. Não prometer funcionamento integral offline.
- Sem confirmação de sincronização offline de cadastros/tomadas; acesso ao Supabase requer rede.
- App Android e web têm releases separados: deploy web não atualiza os arquivos empacotados de um APK instalado.

## Observações
O arquivo principal concentra muita lógica; uma refatoração em módulos e testes é recomendável, mas não deve ser confundida com a migração de ambiente. Regras e limitações estão documentadas separadamente.
