# Controle de medicação

- `app/`: interface React responsiva, baseada em Material Design.
- `api/`: API PHP que repassa a sessão do usuário ao Supabase e respeita RLS.
- `supabase/migrations/`: tabelas de rotinas e histórico de tomadas, com políticas por usuário.

A prévia usa dados demonstrativos locais. A integração final liga a interface à API PHP, aplica a migração no Supabase e habilita autenticação.
Configure `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` no servidor PHP. Nunca use secret key ou `service_role` no frontend.
