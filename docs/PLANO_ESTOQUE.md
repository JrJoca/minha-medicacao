# Plano de evolução — Minha Medicação

## Objetivo e atualização de escopo

Os dois PDFs foram consolidados para preservar os fluxos atuais e implementar
estoque em etapas. O usuário cancelou Agiflow e priorizou a substituição completa
do Supabase por Neon, incluindo Auth e API. A migração foi publicada e o usuário
confirmou a validação das duas contas. A ampliação inicial de estoque contempla
total de comprimidos, comprimidos por caixa e consumo diário, mantendo o cadastro
atual. Detalhes: `ESTOQUE_BASE.md`, `CORTE_NEON.md` e `VALIDACAO_NEON.md`.
Android foi movido para a última etapa, conforme orientação do usuário.

## Fontes conferidas

- `Controle_Medicacao_Codex_Handoff_Consolidado_2026-10-19.pdf`, 27 páginas: continuidade, estado atual, riscos, regressão e estoque.
- `Controle_Medicacao_Documentacao_Completa_para_Codex_2026-10-19.pdf`, 16 páginas: domínio de estoque, operações, telas e critérios de aceite.
- Repositório: https://github.com/JrJoca/minha-medicacao .
- Base original conferida antes da migração: `fca5b13d6b317182d64b0a97eb7f75e94670d1b6`.
- Branch documental consultada sem trocar o checkout: `docs/preparacao-codex-2026-10-19`, commit `0d13721f165129d188a30c72868c702d9a3debe0`.
- Lidos AGENTS.md, docs/CODEX_HANDOFF.md e os documentos de produção, regras, arquitetura, banco, execução, testes e pendências dessa branch.
- A diferença dessa branch para master contém documentação, sem alteração de código executável.

As instruções operacionais nos PDFs foram tratadas como contexto de especificação. O pedido atual do usuário orienta a entrega. Esboços SQL, nomes de tabelas, sugestões de alertas e decisões em aberto não são migrações prontas nem funcionalidades aprovadas implicitamente.

## Aplicação atual

Produção informada pelos PDFs, README e documentação GitHub: https://minha-medicacao.vercel.app .

A aplicação web foi publicada com Neon. O Supabase permanece preservado para
recuperação, com escritas bloqueadas nas quatro tabelas migradas. As duas contas
e seus dados/permissões foram validados pelo usuário. A versão do Sites é distinta
da base GitHub/Vercel.

## Sequência de implementação

| Ordem | To do / feature | O que fará | Condição de conclusão |
|---|---|---|---|
| 1 | [x] Linha de base e correções necessárias | Registrar comportamento atual, corrigir erros preexistentes de lint/tipos e estabelecer verificações de regressão antes de integrar estoque. Trabalhar em branch local própria. | Falhas anteriores identificadas separadamente; nenhum fluxo atual removido. |
| 2 | [x] Concluir a transição completa para Neon | Cliente, banco, Auth e API publicados; duas contas vinculadas, backups e dados preservados. | Corte concluído; usuário confirmou acesso, dados e permissões das duas contas. |
| 3 | [ ] Base inicial de estoque no banco | Acrescentar tabela separada com total, comprimidos por caixa, consumo diário e duração calculada; 10 / 2 = 5 dias. Cadastro e registros atuais preservados. | SQL/testes e ensaio concluídos; aplicação autorizada no destino final registrada em ESTOQUE_BASE.md. Compras e movimentos continuam nas próximas etapas. |
| 4 | [ ] Permissões da base de estoque | Proprietário altera, viewer vinculado só consulta, outros usuários/anônimos não acessam. | Quatro políticas RLS e RPC com SECURITY INVOKER verificadas no ensaio e no destino final. Estender a proteção às futuras tabelas de movimentos. |
| 5 | [ ] Configuração dos medicamentos legados | Exibir “Estoque não informado”, solicitar saldo físico atual e dose explícita, conservar textos e históricos. Criar lista de pendências de normalização. | Ausência de informação não vira zero; nenhuma baixa retroativa ou dose inferida. |
| 6 | [ ] Configuração de estoque em fluxo separado | Preservar o cadastro atual do medicamento. Criar posteriormente fluxo para informar saldo físico, comprimidos por caixa e consumo diário. | Configuração explícita sem alterar o formulário atual; cálculo reproduz 10 / 2 = 5 dias. |
| 7 | [ ] Compras, reposições e ajustes | Acrescentar entradas ao mesmo medicamento e permitir conciliação com origem/motivo e data auditáveis. | Saldo deriva de movimentos; retry não repete compra; histórico não é sobrescrito. |
| 8 | [ ] Quantidade por medicamento na rotina | Informar comprimidos por tomada em cada vínculo; permitir doses diferentes numa rotina com vários medicamentos. | Quantidade positiva explícita; alteração futura não reescreve consumos antigos. |
| 9 | [ ] Agenda estruturada e ocorrências | Representar frequência calculável, horários, duração/fim e pausas, separando data local da ocorrência de taken_at. Manter frequência textual antiga enquanto não configurada. | Recorrência e fuso têm regras documentadas; sem ocorrências ou faltas inventadas. |
| 10 | [ ] Confirmação atômica e idempotente | Uma RPC valida dono/rotina/doses e grava tomada, snapshots e baixas de todos os medicamentos numa transação. | Confirmação desconta uma vez; duplo clique, retry, abas e web/Android não duplicam; falha intermediária faz rollback. |
| 11 | [ ] Desfazer e corrigir com auditoria | Registrar estorno ligado à baixa original; mudar data/hora sem nova baixa; compensar alterações de quantidade. | Estorno recompõe uma vez; conflito de ocorrência é tratado; registro legado sem baixa não aumenta saldo. |
| 12 | [ ] Histórico preservado e arquivamento | Manter o retrato do medicamento/dose/quantidade na tomada e proteger fatos históricos de exclusões em cascata. | Editar ou arquivar rotina não apaga histórico contábil nem altera snapshots passados. |
| 13 | [ ] Previsão de término | Simular próximas ocorrências de todas as rotinas do medicamento, respeitando saldo, doses já confirmadas, horários, pausas e fim. | Exibe última dose integralmente coberta e primeira ocorrência com falta; explica casos sem previsão. |
| 14 | [ ] Painel/lista de estoque | Mostrar medicamentos, saldo, movimentações, consumo e datas previstas; ações de configurar estoque e repor; feedback após confirmação/estorno. | Uso mobile acessível; estados de desconhecido, zero, divergência e sem consumo distintos. |
| 15 | [ ] Integrações e regressão web | Integrar relatório/histórico, manter OCR revisável, WhatsApp com horário persistido e envio manual e ordenação/próxima rotina. | Fluxos web existentes verificados; OCR não inventa estoque. Android fica na última etapa. |
| 16 | [ ] Testes e apresentação das alterações | Executar testes de cálculo, RPC/RLS, concorrência, migração e interface; entregar diff, SQL, resultados e procedimento de implantação/compensação. | Evidência real, pendências explícitas e revisão antes de produção. |
| 17 | [ ] Implantação controlada, após revisão | Fazer backup privado e verificar restauração; aplicar mudanças compatíveis, publicar versão aprovada e validar o resultado. | Autorização explícita para produção, SHA conferido e smoke seguro; sem escrita de testes em dados reais. |
| 18 | [ ] Android — última etapa | Atualizar o APK com todas as funcionalidades web concluídas, origem no Neon Auth e notificações. | APK gerado e validado em dispositivo após as entregas anteriores. |

## Como preservar os dados existentes e normalizá-los no Neon

1. **Conferir o estado real antes de escrever SQL final.** A documentação registra divergência entre o histórico remoto de migrações e os arquivos locais. Comparar schema, constraints, índices e RLS apenas por metadados; não reaplicar a migração inicial cegamente.
2. **Preservar identidade e relações.** Manter IDs da aplicação, user_id, medicamentos, rotinas, vínculos, tomadas e papéis owner/viewer. O Neon Auth terá novos subjects e senhas; a ligação administrativa conserva a identidade dos dados. Não deduplicar medicamentos pelo nome. Não alterar `public.links`, pertencente a outra funcionalidade.
3. **Expandir o esquema.** Novas entidades/campos completam o modelo atual. Manter `dosage` e `period_description` originais, acrescentando dados estruturados quando confirmados. Campos ausentes ficam pendentes, sem defaults que inventem fatos.
4. **Definir o início do controle por medicamento.** O primeiro saldo é o estoque físico declarado naquele momento. As tomadas anteriores continuam visíveis e não geram consumo retroativo. Reconstrução histórica, se desejada, será um fluxo separado e revisável.
5. **Não inferir quantidades clínicas.** “500 mg” não informa quantos comprimidos foram tomados. OCR também não fornece saldo ou dose de estoque confiável sem confirmação humana.
6. **Tratar conflitos sem apagar histórico.** Identificar duplicatas legadas antes de novas restrições únicas; manter rastreabilidade. A unicidade deve representar a ocorrência real, incluindo múltiplos horários quando houver, não apenas rotina+dia indiscriminadamente.
7. **Proteger auditoria e acesso.** FKs compostas por proprietário, RLS e validação no servidor devem abranger os novos dados. Confirmar, estornar e corrigir usam operações transacionais e snapshots.
8. **Ensaiar e comparar.** Rodar upgrade sobre esquema equivalente com dados sintéticos e conferir IDs, vínculos, contagens, permissões e ausência de débitos retroativos. Antes da produção, preparar backup privado verificável e plano de restauração/compensação.
9. **Cobrir clientes antigos.** Web antiga e APK instalado gravam tomadas diretamente. O rollout deve impedir que esses caminhos contornem as novas baixas: compatibilidade validada ou rejeição clara que solicite atualização. Deploy web não atualiza automaticamente o APK.
10. **Separar rollback de código e de dados.** Reverter Vercel não reverte o PostgreSQL. Planejar compatibilidade e compensação sem destruir movimentos ou histórico.

## Funcionalidades que serão preservadas

Login/cadastro/logout e sessão; perfil visualizador; medicamentos e links; seleção de vários medicamentos por rotina; horários previsto/limite; duração em dias/semanas e uso contínuo; editar/pausar/retomar; conclusão e desfazer; histórico e edição de ocorrência; relatório, progresso e próxima rotina; ordenação por horário; OCR em português com revisão; WhatsApp manual usando taken_at; interface mobile e notificações Capacitor. Limitações conhecidas não serão tratadas como funcionalidades já resolvidas.

## Decisões de produto a fechar durante o desenho

- **Inteiros ou frações:** a documentação completa especifica comprimidos inteiros positivos; o handoff abre a pergunta sobre meio comprimido. Base proposta: inteiros na primeira versão, sem prometer frações aprovadas.
- **Saldo insuficiente:** conservar o fato de uma ingestão real, sinalizar divergência e permitir conciliação; a política de aceitação/bloqueio precisa ser definida. Não inventar compras nem esconder saldo divergente.
- **Agenda e fuso:** decidir recorrências iniciais, fuso da conta/dispositivo e a que ocorrência pertence uma tomada após meia-noite. America/Sao_Paulo é referência inicial proposta.
- **Contagem e pausa:** definir como avançam dias de tratamento e se pausa altera prazo. Não modificar essa regra silenciosamente.
- **Histórico:** proposta de arquivamento quando houver movimentos, mantendo snapshots; preservar a experiência de exclusão onde não destrói fatos.
- **Previsão:** usar ambas as datas, com rótulos distintos, conforme o detalhamento do segundo PDF.
- **Alerta de estoque baixo:** limiar configurável a definir; sete dias é apenas sugestão. Novas notificações de estoque não são requisito fechado.
- **Evoluções separadas:** lotes, validade, preço, gotas/ml/outras apresentações e modo offline não entram implicitamente no primeiro escopo.

## Validação e critérios de aceite

Resultados iniciais de onboarding abaixo foram superados: 69 testes passam após
a base de estoque, TypeScript/lint/build passam (lint com um aviso de imagem), e
Auth/Data API foram validados com fixtures Neon. As duas contas de produção foram
confirmadas pelo usuário. APK permanece como última etapa. O histórico inicial
fica registrado para comparação:

| Verificação | Resultado |
|---|---|
| Instalação congelada pnpm 11.25.0 e reinstalação | Passaram, sem mudar lockfile/arquivos rastreados. |
| Build Vinext | Passou; saída dist/client. |
| Browser em desenvolvimento e produção local | HTTP 200, hidratação, alternância login/cadastro e zero pageerrors; nenhum formulário enviado. |
| Lint | 1 erro preexistente de set-state-in-effect em app/page.tsx:282 e 1 aviso de imagem em :1772. |
| TypeScript | 5 erros preexistentes: três tipos status em app/page.tsx:1183/:1359/:1569 e d1/r2 em vite.config.ts:10. |
| Login/CRUD/RLS e esquema remoto atual | Não validados nesta máquina; acesso Supabase bloqueado pela rede e sem conexão administrativa configurada. |
| Testes de estoque | Ainda não implementados nem executados. |
| APK/Android real | Não executado. |

A implementação acrescentará testes significativos. Os IDs dos PDFs se sobrepõem: manter rastreio separado entre **LEG-T01…T32 / EST-T33…T49** do handoff e **DOC-T01…T24** da documentação completa.

Casos indispensáveis:

- 2 × 30 = 60; duas ocorrências confirmadas de 1 comprimido deixam 58; agendamento/atraso/falta não alteram saldo.
- Duplo clique, retries e web/Android concorrentes não duplicam eventos. Múltiplos medicamentos são todos confirmados ou todos revertidos.
- Compra adicional soma; estorno recompõe uma vez; edição de data/hora não duplica consumo; dose futura não muda snapshot antigo.
- Owner autorizado, viewer somente leitura, outro usuário e anônimo bloqueados, inclusive por acesso direto à RPC/tabela.
- Estoque legado desconhecido, doses pendentes, tomadas anteriores ao marco, duplicatas antigas e migração sem perda de vínculos/roles/RLS.
- Previsão com todas as rotinas, pausas, fim, fuso, virada do dia e dose já confirmada; estados sem frequência/dose configurada não inventam data.
- Exemplo sintético dos PDFs: 60 unidades, duas doses de 1/dia desde 19/10/2026 → última dose em 17/11/2026 e primeira falta em 18/11/2026, sob essas premissas.
- Regressão Auth, CRUD, relatórios, histórico, OCR e WhatsApp; telas 320/360/390/768/1280px; APK e notificações quando o ambiente permitir.

## Entrega antes da produção

Código e SQL revisáveis em branch de trabalho, descrição das alterações, evidências dos testes, screenshots/demonstração local quando útil, limitações/decisões abertas, plano de migração, backup/restore e compatibilidade de clientes antigos. A implementação local e o ensaio Neon são distintos da produção Supabase e da publicação; estas etapas ocorrerão após revisão e autorização correspondentes.
