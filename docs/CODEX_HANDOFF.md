# Preparação para continuidade no Codex

Referência: 19/10/2026, America/Sao_Paulo.

## Objetivo
Continuar a manutenção do sistema Minha medicação pelo Codex, preservando código, regras e dados de produção. Esta entrega prepara documentação; não executa migração de dados, troca de hospedagem, deploy, correções funcionais ou mudanças de segurança.

## Ordem de leitura
1. AGENTS.md — orientações obrigatórias de trabalho.
2. docs/PRODUCAO.md — ambientes, hashes e riscos de publicação.
3. docs/REGRAS_DO_SISTEMA.md — requisitos e comportamento observado.
4. ARCHITECTURE.md — arquitetura efetiva, incluindo diferença entre PHP opcional e acesso direto.
5. docs/BANCO_E_ACESSO.md — tabelas, RLS e preservação dos dados.
6. docs/EXECUCAO_E_MIGRACAO.md — instalação, Android, transição e rollback.
7. docs/TESTES_DE_ACEITE.md — roteiro de testes.
8. docs/PENDENCIAS_E_SEGURANCA.md — limitações e recomendações ainda não implementadas.

## De onde vem a memória
- Histórico disponível nesta conversa: requisitos, ajustes e decisões do usuário.
- Código GitHub fixado em fca5b13d6b317182d64b0a97eb7f75e94670d1b6.
- Metadados atuais do Sites e da Vercel.
- Consulta da estrutura e das políticas do Supabase, sem copiar linhas de dados de saúde.
- Auditoria anterior nesta conversa, separada dos achados revalidados agora.

Conversas não disponíveis, anexos antigos ausentes e alterações locais de outros computadores não estão incluídos. Não afirmar que esta documentação é uma transcrição integral ou memória automática da conta ChatGPT.

## Situação da preparação
- Os documentos ficam em branch de preparação, baseada no mesmo commit da produção.
- Nenhum código executável foi alterado.
- Produção, permissões, usuários e banco não foram alterados.
- O ambiente de execução desta sessão estava indisponível: não foram executados build, lint, testes de navegador autenticado ou geração de APK.
- A estrutura de banco e as políticas de proprietário/visualizador foram consultadas novamente.
- O domínio público retornou HTTP 200; isso não equivale a teste funcional completo.

## Primeiro pedido sugerido no Codex
> Leia AGENTS.md e toda a documentação de continuidade indicada em docs/CODEX_HANDOFF.md. Identifique a branch e o commit atuais, confirme a relação com o deployment de produção e execute os testes locais disponíveis. Não publique, não faça push em master e não altere o Supabase de produção. Apresente os resultados e proponha as próximas correções, distinguindo regras desejadas de limitações já documentadas.
