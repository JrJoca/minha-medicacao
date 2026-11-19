# Android — notificações por recorrência (17/11/2026)

## Escopo

Implementação em `lib/notification-schedule.ts` (planejamento puro) e
`lib/native-notifications.ts` (Capacitor), com integração em
`components/medication-app.tsx`.

Não muda Neon, saldos, confirmações de tomada ou dose prescrita. Não publica APK
automaticamente. O comportamento deve ser verificado em dispositivo físico.

## Regras

- Rotinas pausadas ou arquivadas não geram novas notificações.
- Regras de calendário estruturado determinam se há ocorrência.
- **Diária contínua** no mesmo fuso do dispositivo: repete diariamente no
  agendador nativo do sistema.
- **Dias da semana** contínuos no mesmo fuso: usa uma repetição nativa por dia
  selecionado (Capacitor usa domingo=1; o domínio usa domingo=0).
- **Intervalo de 7 dias** contínuo no mesmo fuso: repete semanalmente no
  dia de início; para intervalos N>1 diferentes de 7 usa instantes futuros
  calculados desde `startDate`, sem ciclos N×24h sujeitos a DST.
- Tratamentos com `endDate` e tratamentos cujo início ainda não chegou são
  agendados com datas absolutas, sem eventos antes do início ou depois do fim.
- Se o fuso da rotina difere do dispositivo, datas absolutas mantêm o fuso da
  prescrição; reabrir o aplicativo renova a agenda conforme a zona.
- Se o horário civil não existe devido ao horário de verão, o evento é ignorado
  em vez de ser deslocado de horário.
- As rotinas antigas diárias continuam repetindo; frequência legada
  `other` não é interpretada automaticamente como diária.
- Lembretes antigos desta aplicação são cancelados quando se tornam obsoletos,
  sem cancelar notificações pertencentes a outras partes do app.
- A agenda é reconstruída em login, mudança de rotina, retorno ao app e foco.
  Sair da conta remove lembretes gerenciados pelo usuário anterior.

## Cancelamento de rotinas pausadas e tratamentos concluídos (reforço)

- Ao confirmar **Pausar** ou **Arquivar** no servidor, o Android tenta cancelar
  imediatamente os avisos futuros e remove da bandeja os avisos já entregues da
  rotina. Uma falha de cancelamento é apresentada na interface, e uma nova
  sincronização é tentada ao reabrir/retomar o aplicativo.
- A sincronização calcula apenas notificações de rotinas ativas, não arquivadas
  e com `reminders_enabled` diferente de `false`. Os IDs antigos de
  tratamentos encerrados são removidos por reconciliação, sem apagar avisos de
  outras rotinas ou funcionalidades do sistema.
- A data `endDate` é **inclusiva**: no último dia ainda há lembretes nos
  horários definidos, mas nenhum agendamento depois dele. A agenda é
  revalidada quando a data local muda, além da abertura e retomada do app.
- **Rotinas legadas sem data explícita de início/fim:** o sistema não presume
  encerramento clínico a partir de `current_day` ou da data de cadastro.
  Para cessar os alertas, pause/arquive a rotina ou configure um calendário
  estruturado com `endDate` após verificar a prescrição.
- Ações feitas em outro dispositivo não podem cancelar alarmes nativos de um
  celular Android que permanece fechado ou offline. O cancelamento nesse
  dispositivo depende de sua próxima sincronização.

## Limitações importantes

1. **Horizonte de datas específicas:** até 120 dias civis a partir da
   sincronização; limite total de 60 notificações pendentes (inclui lembrete
   e horário-limite, e as repetições nativas). Quando existem mais eventos, o
   planejador mantém os primeiros e indica truncamento. O Android não executa
   JavaScript enquanto o aplicativo permanece fechado; intervalos >1 dia (exceto a cada 7 dias contínuos no mesmo fuso)
   precisam que o app seja aberto periodicamente para renovar a agenda.
   **Não prometa recorrência indefinida sem reabertura para N>1.**
2. A atualização de uma rotina feita em outro aparelho só cancela alarmes antigos
   após o dispositivo Android sincronizar novamente (abrir o aplicativo).
3. Em aparelhos Android 12+, alarmes exatos dependem da permissão do sistema.
   Sem ela, o plugin agenda alarmes inexatos, que podem atrasar. Android 13+
   também exige autorização de notificações. Doze e políticas de bateria podem
   atrasar entregas. Não há garantia clínica de horário exato.
4. O modo de som/silêncio, "não perturbe" e preferências do sistema prevalecem.
   Os lembretes não substituem uma estratégia clínica de adesão ao tratamento.

## Validação

- Testes de agendamento puro: `pnpm test:notifications`.
- Regressão geral: `pnpm test:medication-control`, `pnpm exec tsc --noEmit`,
  `pnpm lint` e `pnpm build`.
- Atualizar projeto Android (em máquina com SDK): `pnpm exec cap sync android`.
- Validar em dispositivo Android (notificações autorizadas e sem permissão
  exata) os cenários seguintes:
  1. Segunda e quarta: não dispara terça; ambos os horários corretos.
  2. A cada 3 dias: utiliza a data de início como âncora, inclusive ao virar mês.
  3. Início no futuro e término no próximo dia: nenhum disparo fora do período.
  4. Pausar, retomar, arquivar: alarmes pendentes são ajustados.
  5. Logout, troca de usuário, re-login e retorno do app: remove e renova,
     sem duplicar alarmes e sem vazar a rotina do usuário anterior.
  6. Dispositivo em outro fuso, modo Doze e permissões negadas.
  7. Após tempo suficiente para esgotar a fila, reabrir o app renova o horizonte.
  8. Vários medicamentos com horários coincidentes e mais de 60 notificações
     futuras: próximo agendamento priorizado, com limitação conhecida.

## Pendências fora desta entrega

- APK compilado, instalação e testes manuais em dispositivo físico.
- Reabastecimento autônomo em segundo plano para intervalos longos sem
  abertura do app (requer estratégia nativa Android/WorkManager/AlarmManager).
- Revisar UX e acessibilidade dos avisos visíveis sobre fila truncada,
  permissão negada e alarmes inexatos, implementados no app.
- Verificar re-sincronização após reinicialização do aparelho e restrições do
  fabricante.

Referência do plugin: https://github.com/ionic-team/capacitor-local-notifications
