# Instruções para o Codex — Minha medicação

Leia primeiro docs/CODEX_HANDOFF.md, docs/REGRAS_DO_SISTEMA.md e docs/PRODUCAO.md. A documentação foi consolidada em 19/10/2026 a partir desta conversa, do código e de consultas somente leitura; não representa uma importação integral de todas as conversas.

## Forma de trabalhar
- Responder e documentar em português do Brasil. Preservar nomes técnicos já existentes.
- Examinar git status, branch e alterações locais antes de editar. Preservar trabalho não relacionado.
- Usar uma branch de trabalho. Não fazer push em master, merge, publicação, migração ou alteração de contas de produção sem pedido explícito correspondente.
- master está ligada à produção na Vercel: push pode publicar automaticamente. Branches também podem gerar previews conforme a integração.
- Não substituir este projeto pelo arquivo da versão 16 do Sites: os hashes de origem são diferentes da base GitHub/Vercel atual.
- Manter React/TypeScript + Vinext/Vite, Supabase, Tesseract.js e Capacitor; PHP é integração opcional. Não converter para outro framework ou banco implicitamente.
- Priorizar interface mobile, Material Design, acessibilidade e diálogos utilizáveis em telas pequenas.
- Antes de concluir, executar instalação com lockfile, lint, checagem TypeScript e build, se houver ambiente. Relatar falhas e limitações sem alegar testes não realizados.
- Não inventar scripts de teste: a base não define script test. Implementar testes em mudança própria quando solicitado.

## Dados e segurança
- O Supabase existente é de produção e contém dados reais de saúde. Usar banco/usuários de teste para testes que gravem dados.
- Não apagar, recriar, resetar, popular com exemplos ou reaplicar migrações na produção para preparar o ambiente.
- Não modificar a tabela public.links: pertence a outra funcionalidade no mesmo Supabase.
- Nunca versionar senhas, JWTs, tokens, service_role, chaves secretas, receitas reais, dados de pacientes, dumps ou keystores.
- A chave publishable do frontend é pública por desenho; a proteção obrigatória é RLS.
- O papel viewer e owner_user_id ficam em app_metadata gerenciado por administrador; nunca confiar em user_metadata ou apenas em botões desabilitados.
- Preservar RLS e FKs compostas por usuário. Toda escrita precisa continuar respeitando o JWT do usuário.
- Mudanças de banco devem ter migrações versionadas, revisão de impacto e backup prévio quando aplicável.

## Regras que não podem regredir
- Medicamento é cadastrado antes de ser vinculado à rotina; seleção por lista com botão +.
- Duração pertence à rotina, em dias/semanas, ou uso contínuo.
- Rotinas de hoje em ordem de horário; próxima rotina considera ativas, não concluídas e horário previsto.
- Não tomado somente após a virada do dia local; horário limite é alerta, não muda sozinho o status.
- Editar registro altera aquela ocorrência (data/hora), não a definição de todas as rotinas.
- WhatsApp usa o horário persistido da tomada, nunca um novo horário no momento de enviar. Envio depende de clique manual no WhatsApp.
- OCR apenas para receitas digitadas, com revisão/edição/exclusão antes do cadastro em massa; sem interpretação clínica automática.
- Não tratar limitações conhecidas como recursos já resolvidos: consultar docs/PENDENCIAS_E_SEGURANCA.md.
