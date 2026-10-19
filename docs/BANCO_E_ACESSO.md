# Banco, acesso e preservação

Projeto existente: llftfgtswvmwtbmkegpd. Consulta de estrutura e políticas realizada em 19/10/2026. Não foram exportados dados médicos, contas ou senhas.

## Tabelas do domínio
| Tabela | Colunas principais e significado |
|---|---|
| public.medications | id UUID, user_id UUID, name, dosage, reference_url opcional, created_at |
| public.medication_routines | id UUID, user_id UUID, name, period_description, has_no_end_date, duration_value, duration_unit, current_day, total_days, scheduled_time, deadline_time, reminders_enabled, status, created_at, updated_at |
| public.routine_medications | user_id, routine_id, medication_id, created_at; PK (routine_id, medication_id) |
| public.medication_intakes | id UUID, user_id UUID, routine_id, taken_at timestamptz, created_at |

Todas as quatro tabelas têm RLS habilitado. user_id referencia auth.users. FKs compostas (routine_id,user_id) e (medication_id,user_id) impedem ligações entre proprietários diferentes. Nome possui limite de 1–120 caracteres na base. status de rotina aceita active/paused. duration_unit aceita days/weeks; a restrição de duração combina campos nulos para uso contínuo ou valores positivos para período finito.

A tabela public.links existe no mesmo schema e pertence a outra funcionalidade. Não alterar nem incluir em seeds/resets desta aplicação.

## Políticas atuais
- SELECT: proprietário, ou viewer cujo owner_user_id em app_metadata corresponda ao user_id da linha.
- INSERT/UPDATE/DELETE: proprietário autenticado que não tenha role=viewer.
- UPDATE usa condições de acesso e de verificação.
- Papel/escopo não devem ser editáveis pelo cliente.
- Interface bloqueia mutações do visualizador, mas isso é defesa adicional, não substitui RLS.

A consulta confirmou as políticas das quatro tabelas. Não foi feito novo teste de login com contas reais nem tentativa de escrita nesta preparação.

## Datas e representação
- scheduled_time/deadline_time: time sem fuso; interpretados no horário local do dispositivo.
- taken_at: timestamptz, com now() como padrão do servidor na conclusão comum.
- Não há coluna status de tomada, occurrence_date, data de início/fim explícita, snapshot de nome/dose ou trilha de auditoria de correções.
- Não há restrição única por rotina/dia. A edição consulta conflito no frontend.
- Ausência de registro não diferencia "não tomou", "não era dia" ou "não havia rotina naquela data" por si só.

## Migrações disponíveis e divergência do histórico
- supabase/migrations/202609150001_medication_control.sql cria as quatro tabelas e políticas originais.
- 202609180001_viewer_read_only.sql, na raiz, substitui políticas originais pelas de visualizador.
- Histórico listado no Supabase: 20260908183505/create_user_links e 20260918180420/viewer_read_only_scoped.
- A criação inicial de medicação não apareceu nesse histórico, embora as tabelas existam.
- O arquivo do visualizador está fora de supabase/migrations e tem timestamp diferente do registro aplicado.

Não executar db reset, db push ou ambos os SQLs cegamente na produção. A migração inicial não é idempotente; políticas com mesmo nome também podem conflitar. Antes de automatizar novos ambientes, comparar catálogo, constraints, índices e políticas, consolidar baseline em ambiente isolado e reconciliar o histórico sem reaplicar mudanças já presentes.

## Estratégia de migração para o Codex
1. Manter o projeto Supabase e seus usuários: trocar a ferramenta de desenvolvimento não exige migrar a base.
2. Usar um Supabase separado de desenvolvimento para testes com escrita.
3. Criar somente dados sintéticos nesse ambiente.
4. Obter backup privado antes de mudanças estruturais reais; confirmar retenção/restore disponíveis no plano.
5. Se um novo Supabase for desejado futuramente, planejar separadamente exportação privada de schema/dados/Auth/Storage e configuração de URLs. Não presumir que SQL migra senhas e sessões.
6. Guardar dumps fora do Git e não publicar dados de saúde em issues, PRs ou logs.

## Configuração de Auth
Revisar Site URL e Redirect URLs para domínio web, localhost de teste e origens/deep links Android realmente utilizados. Cadastrar apenas os endereços necessários. O cadastro público existe no código; a decisão de manter/desativar requer validação do proprietário. Não alterar credenciais de usuários automaticamente como parte desta entrega.
