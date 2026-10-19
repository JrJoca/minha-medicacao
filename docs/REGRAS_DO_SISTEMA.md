# Regras do sistema e decisões do usuário

As regras abaixo consolidam os pedidos disponíveis. Quando há diferença entre a intenção e o código atual, ela está explícita.

## Medicamentos
- Cadastro prévio com nome, dosagem e link de referência opcional.
- O período de tratamento é informado na rotina, não no cadastro do medicamento.
- Manter lista de todos os medicamentos cadastrados acessíveis ao usuário conforme RLS.
- Sem dados demonstrativos como substituição silenciosa de falha de conexão.
- Dosagens e nomes devem ser informados/revisados pelo usuário, nunca calculados como recomendação médica.

## Rotinas
- Fluxo: cadastrar medicamento -> criar rotina -> selecionar medicamentos já cadastrados em combobox/lista -> clicar + para vincular.
- Permitir remover itens da seleção e impedir seleção duplicada.
- Informar nome, horário previsto, horário limite, frequência, duração e medicamentos.
- Duração em dias ou semanas; semanas equivalem a 7 dias para total_days.
- Checkbox de uso contínuo/sem término: duration_value, duration_unit e total_days nulos.
- Criar, editar, pausar/retomar e excluir rotinas.
- Card mostra primeiro o título, depois medicamentos de forma direta e horário; exibir progresso como Dia 1/30 ou uso contínuo.
- Alterar a definição da rotina é diferente de editar uma tomada individual.

## Organização da homepage
- Rotinas de hoje ordenadas por horário previsto, não por data de cadastro.
- Próxima rotina: ativa, não concluída e com horário previsto >= horário atual. O código atual não escolhe uma rotina vencida nem busca a de amanhã quando não há candidatas.
- Contadores de progresso consideram rotinas não pausadas.
- Rodapé solicitado: "Início da utilização do sistema no dia 21 de Setembro de 2026".

## Tomadas, status e relatório
- Hoje sem registro: Pendente, mesmo depois do horário limite.
- Após a meia-noite local, dia anterior sem registro esperado: Não tomado.
- Com registro: Tomado; exibir horário efetivamente registrado.
- O horário limite serve para notificação, não para marcar automaticamente como não tomado antes da virada.
- Relatório pode ser consultado durante o próprio dia, com nome, medicamentos/dosagens, previsto, tomado às e status.
- Histórico em tabela com alteração da tomada na própria linha.
- Botão chama-se Editar registro; deve atuar somente na ocorrência selecionada.
- Permitir corrigir data e hora, inclusive a partir de linha sem tomada. Hoje, salvar uma linha sem tomada cria uma tomada; isso não é um registro autônomo de ausência.
- Evitar duas tomadas da mesma rotina/data ao mudar a data. Atualmente existe consulta preventiva no cliente, sem garantia única equivalente no banco.
- Marcação rápida de dia histórico usa a data da linha e o horário atual local. O formulário de edição permite informar a hora desejada.
- Desmarcar apaga o registro; a interface então deriva Pendente/Não tomado.
- No estado atual, taken/pending/missed não são colunas persistidas: são calculados conforme presença de medication_intakes e data consultada.
- Dates/horas são interpretadas no fuso local do aparelho e convertidas para ISO/UTC ao persistir. Não existe configuração de fuso por usuário. America/Sao_Paulo é a referência operacional desta continuidade, não um fuso imposto no código.

## WhatsApp
- Concluir a rotina e oferecer Enviar pelo WhatsApp.
- Mensagem usa taken_at persistido, não a hora do clique no envio.
- Incluir nome da rotina, horário registrado e dia/total ou uso contínuo; nomes dos medicamentos são opcionais.
- Abrir wa.me com texto codificado e telefone normalizado.
- Usuário revisa e toca Enviar no WhatsApp; não há API paga, bot ou envio automático.
- Número e preferência são locais ao dispositivo.
- Visualizador não envia nem altera configuração na implementação atual.

## OCR e cadastro em massa
- Tesseract.js, apenas receitas digitadas; não prometer leitura de manuscritos.
- Selecionar imagem, confirmar que é digitada, reconhecer português, gerar rascunhos.
- Antes de confirmar, permitir editar nome/dosagem/link, excluir itens e adicionar correções.
- Somente confirmação final insere medicamentos em massa.
- Limite atual da UI: imagem até 10 MB. PDFs não têm suporte explícito.
- Extração usa padrões/heurísticas e pode omitir ou interpretar errado; revisão humana é obrigatória.
- OCR não cria prescrições, não recomenda dose e não deve criar rotinas automaticamente sem confirmação.

## Perfil visualizador
- Identificado por app_metadata.role=viewer, com owner_user_id apontando ao proprietário.
- Pode consultar os dados desse proprietário; não de todos os usuários do projeto.
- Não pode criar, editar, excluir, concluir, desfazer, importar ou alterar configurações protegidas.
- A proteção real deve existir no banco via RLS, além da interface.
- Não registrar nem reutilizar a senha histórica compartilhada.

## Design, web e Android
- Material Design como referência; responsivo em celular e desktop.
- Diálogos devem caber na largura da tela e ter rolagem interna, sem esconder botões.
- Relatório deve continuar utilizável em telas estreitas, inclusive edição por linha.
- Manter versão web e APK a partir do mesmo código.
- Notificações nativas dependem de permissão e restrições de bateria/alarme do Android; no navegador não há garantia de notificações em background.

## Diferenças conhecidas
Frequência é texto livre e não um motor de recorrência; current_day não avança automaticamente no código revisado; seleção histórica usa as definições atuais, não snapshots. Consultar pendências antes de declarar essas regras totalmente atendidas.
