# Pendências e segurança

Esta preparação não corrigiu as questões abaixo. Distinguir constatações do código de resultados históricos da auditoria. Não há garantia de ausência de vulnerabilidades.

## Revalidado em 19/10/2026
- Supabase Security Advisor continua indicando Leaked Password Protection Disabled.
- A proteção de proprietário/visualizador por RLS está presente nas quatro tabelas.
- A página pública retornou HTTP 200 e HSTS. A resposta consultada não trouxe CSP, X-Content-Type-Options, Referrer-Policy ou Permissions-Policy.
- Chave de frontend é publishable, não uma service_role.
- Não foram testadas senhas reais nem verificado se a credencial histórica do visualizador foi trocada.

Remediação oficial do alerta: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Prioridades herdadas da auditoria
1. Conta visualizadora: a senha compartilhada histórica era fraca. Verificar troca para credencial longa/única, revogação de sessões e uso de conta individual/MFA quando aplicável. Não armazenar senha na documentação ou no Git. Não afirmar que a senha antiga continua válida sem verificar.
2. Ativar proteção de senhas vazadas conforme disponibilidade do plano e revisar política de senha, confirmação de e-mail e MFA.
3. Decidir se cadastro público faz sentido para uso pessoal. Se mantido, revisar CAPTCHA, confirmação e limites de autenticação. A UI de signup existe; isso não prova que todas as opções do painel estejam liberadas.
4. Validar reference_url por protocolo permitido no cliente e banco. Risco de links maliciosos/phishing; não tratar como XSS demonstrado sem reprodução.
5. Definir CSP compatível com Vinext/Supabase/Tesseract e demais headers. Começar avaliando em preview; não quebrar OCR/auth com uma política copiada sem teste.
6. Rever grants SQL amplos observados na auditoria anterior e revogar permissões desnecessárias. RLS deve continuar habilitado.
7. Substituir exibição direta de error.message por mensagem amigável e logs sem dados sensíveis.
8. Android: revisar allowBackup=true, FileProvider com path amplo e minifyEnabled=false. Minificação é endurecimento, não substitui proteção de segredos.
9. Fazer varredura atual de dependências e do histórico Git para segredos. Não foi executada análise completa de CVEs, npm/pnpm audit ou APK nesta sessão.

## Limitações funcionais confirmadas no código-base
- Frequência é period_description textual; não há cálculo de dias da semana ou intervalos.
- current_day é lido/salvo como campo; não foi encontrado avanço automático. Expiração de duração não filtra rotinas.
- Relatórios são montados com rotinas e medicamentos atuais; não guardam snapshot de dose/nome/horário no instante da tomada.
- Datas históricas podem incluir rotina que não existia ainda; pausadas são excluídas do relatório diário mas aparecem no histórico. Falta modelar elegibilidade por ocorrência.
- Qualquer data não igual a hoje, inclusive futura, pode receber missed sem validação de calendário.
- O relógio é atualizado a cada 30 segundos, mas não há reload diário explícito dos dados ao atravessar meia-noite. taken/status podem ficar obsoletos com app aberto.
- loadData e desfazer conclusão filtram tomadas a partir do início de hoje, sem limite superior; registros futuros podem interferir no estado.
- Não há unicidade de tomada por rotina/dia no banco; duplo clique/duas abas podem gerar duplicatas. A definição de "dia" depende de fuso.
- Editar rotina atualiza definição e substitui vínculos em chamadas separadas; uma falha pode deixar operação parcialmente aplicada. Recomenda-se transação/RPC com RLS, em mudança futura.
- Exclusão de rotina usa ON DELETE CASCADE e remove histórico associado. Não alterar essa decisão sem discutir preservação/auditoria.
- Notificações Android atuais só recebem id/nome/hora/limite/pausada: não respeitam reminders_enabled, fim, frequência detalhada ou conclusão do dia. São repetitivas por relógio e não um calendário completo.
- Número WhatsApp é por dispositivo; não acompanha automaticamente outro computador/APK.
- Não há modo offline com fila de sincronização confirmado.

## Perguntas para evolução, não para bloquear a migração
- O contador avança por dia de calendário, dia de tratamento ou quantidade de tomadas? Pausas contam?
- Uma tomada depois da meia-noite pertence à data real ou à ocorrência do dia anterior?
- "Próxima rotina" deve priorizar atrasadas ou procurar amanhã?
- Histórico deve sobreviver à exclusão de uma rotina e manter doses antigas?
- Qual fuso deve definir o dia em conta usada em múltiplos dispositivos?

Enquanto não houver nova decisão, preservar o comportamento atual e explicitar suas limitações. Não inventar regras clínicas nem alterar datas de registros reais automaticamente.
