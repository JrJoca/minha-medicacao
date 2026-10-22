# Revisão da migração para Neon

Implementação na branch local `feat/neon-migration`, sobre `fca5b13d6b317182d64b0a97eb7f75e94670d1b6`. Sem push, merge ou deploy. A produção continua em https://minha-medicacao.vercel.app, usando Supabase.

## O que mudou

| Feature | Comportamento |
|---|---|
| Cliente Neon | Web/Capacitor usam Neon Auth e Data API por URLs públicas de build; SDK Supabase direto e chave fixa foram removidos. |
| Identidade preservada | O novo subject de login é ligado ao ID antigo da aplicação; medicamentos, rotinas, vínculos e tomadas conservam os IDs. |
| Permissões protegidas | A RPC fornece papel/ID a partir do banco. Proprietário escreve no seu escopo; visualizador só consulta o proprietário vinculado. Metadados editáveis não concedem acesso. |
| Cadastro | Novo usuário precisa de e-mail canônico verificado e recebe escopo próprio. E-mails de contas em migração ficam reservados para não criar outro proprietário. |
| Novas senhas | Interface de confirmação e definição/recuperação por código de e-mail; não tenta importar hashes Supabase. |
| Backup e restauração | Snapshot consistente privado, checksum, validação dos vínculos e importação serializável com comparação de cada campo; divergência reverte o lote. |
| Transição administrativa | Reserva e vinculação exigem IDs/papéis corretos e e-mails verificados; lote incompleto falha sem vínculo parcial. |
| Sessão na interface | Atualização após entrar/sair e descarte de respostas antigas ao trocar de conta; dados de relatórios são limpos ao sair. |
| PHP opcional | Proxy de rotinas repassa o JWT para o Data API Neon, sem chave administrativa. |
| Verificações existentes | Corrigidos os cinco erros de tipos e o erro de lint encontrados no levantamento inicial. |

## Dados e serviços de ensaio

- Projeto Neon: `floral-pond-94925356`, PostgreSQL 18.
- Branch de cópia: `br-empty-water-b5nntdyc` (`codex-supabase-migration-20261021`).
- Dados copiados e comparados exatamente: **7 medicamentos, 2 rotinas, 7 vínculos, 2 tomadas e 2 contas**. Comparação remota repetida após configuração dos serviços: quatro tabelas idênticas ao snapshot.
- Neon Auth e Data API habilitados sem grants indiscriminados. Reservas dos dois e-mails preparadas. A escolha do novo endereço do visualizador está no plano privado; o vínculo com o proprietário foi preservado.
- As duas contas reais ainda não foram criadas no Neon Auth/vinculadas a subjects. A falta de vínculo nega acesso; nenhuma senha foi escolhida nem mensagem enviada às pessoas.
- Branch sintética separada: `br-young-rain-b5wbapds` (`codex-neon-validation-20261021`). Somente fixtures, sem dados de pacientes. Nunca usar como destino da produção.
- A branch Neon `production` e os dados/contas Supabase não receberam escrita. `public.links` não foi consultada, exportada ou alterada.

## Testes executados

| Verificação | Resultado |
|---|---|
| Suíte reproduzível `pnpm test:migration` | **33 aprovados**: 20 PostgreSQL/RLS/restauração/vinculação + 13 validações do executor. |
| Cópia real para Neon de ensaio | Comparação exata das quatro tabelas e dos campos/IDs das contas no commit da importação. |
| API real com JWT emitido pelo Neon | Proprietário, visualizador e outro proprietário: login, contexto com ID estável, leitura isolada e permissões de escrita corretas. |
| Negativas da API | Sem token, token anônimo válido e token real com assinatura adulterada recusados. Viewer não insere, atualiza, exclui nem se promove por RPC. |
| Novo cadastro real | Cadastro sintético aceito; após verificação administrativa da fixture, RPC criou outro ID estável e escopo vazio próprio. Não houve envio de e-mail. |
| Vinculação remota | Reserva/revinculação atômica de três fixtures preservou IDs e papéis; funções temporárias de diagnóstico foram removidas. |
| Navegador com serviços reais | Três perfis: entrar, carregar somente seus dados, bloquear botões de alteração do viewer, sair e limpar dados; zero pageerrors. |
| Interface OTP com transporte simulado | Cadastro, confirmação, reenvio e recuperação/troca de senha passaram; nenhum e-mail real foi disparado. |
| TypeScript | Passou. |
| Lint | Passou, com um aviso preexistente de imagem. Nenhuma regra foi desabilitada. |
| Build e instalação congelada | Passaram; saída `dist/client` conferida para a cópia de ensaio, sem endpoint de fixtures ou host Supabase antigo. |
| Execução do build local | HTTP 200, hidratação, alternância login/cadastro e zero pageerrors. |

O navegador headless usou requisições HTTPS encaminhadas pelo Playwright com proxy e TLS verificado, pois o Chromium isolado não reconhece a CA do proxy deste ambiente. Não se desativou a verificação TLS. Isso não substitui teste em Android/WebView real.

## Pendências antes da produção

1. Revisar código, SQL, procedimento e este relatório.
2. Concluir acesso das duas contas com novas senhas e códigos definidos pelas próprias pessoas; executar a ligação administrativa e conferir as permissões. Não enviar senhas no chat.
3. Guardar backup privado durável fora deste ambiente e conferir recuperação. O snapshot local inclui dados pessoais e hashes antigos e não deve ser versionado/publicado.
4. Definir a janela de corte, obter snapshot atualizado e tratar escritas posteriores sem perda. Rollback do frontend sozinho não reconcilia novas escritas no Neon.
5. Configurar origem e URLs do destino final; gerar build próprio e validar regressão web, e-mail OTP e Android. Entrega real dos códigos, APK/notificações em dispositivo e PHP não foram testados neste ambiente; falta SDK Android/PHP.
6. Apresentar a versão final e obter autorização para a mudança de produção. Preservar Supabase e deployment anterior durante a validação.
7. Após estabilizar a migração, implementar as features de estoque na ordem de `PLANO_ESTOQUE.md`.

## Arquivos para revisão

- `lib/neon.ts`, `app/page.tsx`: cliente, identidade e fluxos de login.
- `neon/migrations/202610210001_medication_core.sql`: quatro tabelas, identidade e RLS.
- `neon/migrations/202610210002_account_registration.sql`: reservas e cadastro verificado.
- `scripts/neon-migration.py`: backup, validação, importação e transição administrativa somente em ensaio.
- `scripts/rehearse-neon-backup.mjs`, `tests/`: restauração local e testes sintéticos.
- `docs/MIGRACAO_NEON.md`, `README.md`, `ARCHITECTURE.md`: configuração, procedimentos e corte.
- `package.json`/lockfile/workspace: SDK oficial fixado em 0.8.0-beta e PGlite 0.5.9, sem relaxar a maturação de dependências. O postinstall de banner do core-js permanece bloqueado explicitamente.
