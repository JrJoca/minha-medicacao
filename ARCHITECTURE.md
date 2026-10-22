# Controle de medicação

O cliente React consulta o Neon Data API diretamente pelo SDK oficial em
`lib/neon.ts`. Neon Auth emite os JWTs verificados pelo Data API; senhas e chaves
administrativas não são distribuídas ao navegador. O mesmo cliente é empacotado
pelo Capacitor no Android. OCR, notificações locais e envio manual pelo WhatsApp
continuam nos módulos existentes.

As quatro tabelas públicas conservam os IDs e valores da origem. O esquema
`application_private` guarda as contas, os papéis, os vínculos de visualizador e
as reservas de e-mail para migração. O cliente recebe seu ID estável e papel pela
RPC protegida `application_context()`. As políticas RLS usam essa identidade,
sem confiar em metadados editáveis do login.

Cadastros novos recebem seu próprio escopo após verificação canônica do e-mail.
Contas antigas exigem vinculação administrativa explícita; a reserva do novo
e-mail de visualizador impede a criação acidental de um perfil proprietário.
Veja [MIGRACAO_NEON.md](docs/MIGRACAO_NEON.md) para backup, restauração, testes e corte.

`api/routines.php` é um proxy opcional para o Data API configurado por
`NEON_DATA_API_URL`; não participa do fluxo normal do frontend. A estrutura
`supabase/migrations` permanece como histórico da origem. A produção existente
continua no Supabase enquanto esta branch é revisada.
