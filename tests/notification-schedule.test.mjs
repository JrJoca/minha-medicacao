import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNotificationPlan,
  isMedicationNotification,
  isRoutineMedicationNotification,
  reconcileMedicationNotifications,
  MAX_PENDING_NOTIFICATIONS,
} from "../lib/notification-schedule.ts";

const now = new Date("2026-11-17T15:00:00Z"); // terça 12h em São Paulo
const routine = (overrides = {}) => ({
  id: "routine-123",
  name: "Rotina de testes",
  time: "08:00",
  limit: "09:00",
  paused: false,
  archivedAt: null,
  frequencyKind: "daily",
  recurrenceRule: null,
  recurrenceTimezone: null,
  ...overrides,
});
const planned = (routines, instant = now, timezone = "America/Sao_Paulo") =>
  buildNotificationPlan(routines, instant, timezone);
const times = plan => plan.notifications
  .filter(n => n.extra.kind === "reminder" && n.schedule.at)
  .map(n => n.schedule.at.toISOString());

test("recorrência semanal contínua usa dias nativos corretos do Capacitor (domingo=1)", () => {
  const result = planned([routine({
    recurrenceRule: { kind: "weekdays", startDate: "2026-11-16", weekdays: [1, 5] },
    recurrenceTimezone: "America/Sao_Paulo",
  })]);
  assert.equal(result.notifications.length, 4);
  assert.deepEqual(
    result.notifications.filter(n => n.extra.kind === "reminder").map(n => n.schedule.on.weekday),
    [2, 6],
  );
  assert.ok(result.notifications.every(n => n.schedule.repeats === true && !n.schedule.at));
});

test("intervalo de três dias usa a data inicial como âncora e agenda instantes não repetitivos", () => {
  const result = planned([routine({
    frequencyKind: "other",
    recurrenceRule: { kind: "interval", startDate: "2026-11-16", everyDays: 3 },
    recurrenceTimezone: "America/Sao_Paulo",
  })]);
  assert.deepEqual(times(result).slice(0, 3), [
    "2026-11-19T11:00:00.000Z",
    "2026-11-22T11:00:00.000Z",
    "2026-11-25T11:00:00.000Z",
  ]);
  assert.ok(result.notifications.every(n => !n.schedule.repeats));
});

test("intervalo de sete dias usa um alarme semanal permanente ancorado no início", () => {
  const result = planned([routine({
    frequencyKind: "other",
    recurrenceRule: { kind: "interval", startDate: "2026-11-16", everyDays: 7 },
    recurrenceTimezone: "America/Sao_Paulo",
  })]);
  assert.equal(result.notifications.length, 2);
  assert.ok(result.notifications.every(n => n.schedule.repeats));
  assert.deepEqual(result.notifications.map(n => n.schedule.on.weekday), [2, 2]);
});

test("início futuro não dispara alarmes antes do início, mesmo com regra contínua", () => {
  const result = planned([routine({
    recurrenceRule: { kind: "weekdays", startDate: "2026-11-23", weekdays: [1] },
    recurrenceTimezone: "America/Sao_Paulo",
  })]);
  assert.equal(times(result)[0], "2026-11-23T11:00:00.000Z");
  assert.ok(result.notifications.every(n => !n.schedule.repeats));
});

test("tratamento encerrado gera zero alarmes; fim é inclusivo", () => {
  const passed = planned([routine({
    recurrenceRule: { kind: "daily", startDate: "2026-11-01", endDate: "2026-11-16" },
    recurrenceTimezone: "America/Sao_Paulo",
  })]);
  assert.equal(passed.notifications.length, 0);
  const today = planned([routine({
    recurrenceRule: { kind: "daily", startDate: "2026-11-16", endDate: "2026-11-17" },
    recurrenceTimezone: "America/Sao_Paulo",
    time: "18:00",
    limit: "19:00",
  })]);
  assert.equal(today.notifications.length, 2);
  assert.deepEqual(times(today), ["2026-11-17T21:00:00.000Z"]);
});

test("pausadas, arquivadas ou com frequência antiga desconhecida não criam falsos lembretes", () => {
  const rule = { kind: "weekdays", startDate: "2026-11-16", weekdays: [2] };
  const p = planned([
    routine({ paused: true, recurrenceRule: rule, recurrenceTimezone: "America/Sao_Paulo" }),
    routine({ id: "archived", archivedAt: "2026-11-01", recurrenceRule: rule, recurrenceTimezone: "America/Sao_Paulo" }),
    routine({ id: "other", frequencyKind: "other" }),
    routine({ id: "invalid", recurrenceRule: { kind: "interval", startDate: "2026-11-16", everyDays: 0 }, recurrenceTimezone: "America/Sao_Paulo" }),
  ]);
  assert.equal(p.notifications.length, 0);
  assert.equal(p.skipped, 2);
});

test("legado diário mantém agendamento nativo sem exigir migração; hora de aviso e limite separadas", () => {
  const p = planned([routine({ recurrenceRule: null, recurrenceTimezone: null })]);
  assert.equal(p.notifications.length, 2);
  assert.deepEqual(p.notifications.map(n => n.schedule.on), [
    { hour: 8, minute: 0 }, { hour: 9, minute: 0 },
  ]);
});

test("fuso da rotina diferente do dispositivo usa instantes absolutos (não cron local)", () => {
  const p = planned([routine({
    recurrenceRule: { kind: "weekdays", startDate: "2026-11-16", weekdays: [2, 4] },
    recurrenceTimezone: "America/Sao_Paulo",
  })], now, "UTC");
  assert.ok(p.notifications.length > 0);
  assert.ok(p.notifications.every(n => n.schedule.at instanceof Date && !n.schedule.on));
  assert.equal(times(p)[0], "2026-11-19T11:00:00.000Z");
});

test("não altera horário quando ocorre um horário inexistente no início do verão", () => {
  const p = planned([routine({
    recurrenceRule: { kind: "daily", startDate: "2026-03-07", endDate: "2026-03-09" },
    recurrenceTimezone: "America/New_York",
    time: "02:30",
    limit: "02:45",
  })], new Date("2026-03-07T00:00:00Z"), "America/Sao_Paulo");
  const scheduled = p.notifications.filter(n => n.extra.kind === "reminder");
  assert.equal(scheduled.length, 2); // 7 e 9, não 8/03/2026 (sem 02h30)
  assert.equal(scheduled[0].schedule.at.toISOString(), "2026-03-07T07:30:00.000Z");
  assert.equal(scheduled[1].schedule.at.toISOString(), "2026-03-09T06:30:00.000Z");
});

test("datas e IDs estáveis na mesma janela; não há IDs duplicados", () => {
  const r = routine({
    recurrenceRule: { kind: "interval", startDate: "2026-11-16", everyDays: 5 },
    recurrenceTimezone: "America/Sao_Paulo",
  });
  const a = planned([r]);
  const b = planned([r], new Date("2026-11-17T15:01:00Z"));
  assert.deepEqual(a.notifications.map(n => n.id), b.notifications.map(n => n.id));
  assert.equal(new Set(a.notifications.map(n => n.id)).size, a.notifications.length);
  assert.ok(a.notifications.every(n => n.id > 0 && n.id <= 2147483647));
});

test("limite de agendamentos preserva os próximos eventos e sinaliza truncamento", () => {
  const routines = Array.from({ length: 10 }, (_, i) => routine({
    id: "multiple-" + i,
    recurrenceRule: { kind: "interval", startDate: "2026-11-17", everyDays: 3 },
    recurrenceTimezone: "America/Sao_Paulo",
  }));
  const p = planned(routines);
  assert.equal(p.notifications.length, MAX_PENDING_NOTIFICATIONS);
  assert.equal(p.truncated, true);
  assert.equal(new Set(p.notifications.map(n => n.id)).size, MAX_PENDING_NOTIFICATIONS);
  assert.ok(p.notifications.every(n => n.schedule.at > now));
});

test("não cancela notificações de outros recursos e identifica notificações antigas do app", () => {
  assert.equal(isMedicationNotification({ extra: { app: "minha-medicacao", version: 2 } }), true);
  assert.equal(isMedicationNotification({ extra: { routineId: "r1", kind: "deadline" } }), true);
  assert.equal(isMedicationNotification({ extra: { other: true } }), false);
  assert.equal(isMedicationNotification({ extra: null }), false);
});

test("recusa horas inválidas e timezone desconhecido sem agendar alertas diários errados", () => {
  const rule = { kind: "daily", startDate: "2026-11-16" };
  const p = planned([
    routine({ time: "26:00" }),
    routine({ id: "tz", recurrenceRule: rule, recurrenceTimezone: "Invalid/Timezone" }),
    routine({ id: "missing", recurrenceRule: rule, recurrenceTimezone: null }),
  ]);
  assert.equal(p.notifications.length, 0);
  assert.equal(p.skipped, 3);
});


test("pausar uma rotina cancela os lembretes que já estavam agendados", () => {
  const r = routine({
    id: "pause-test",
    recurrenceRule: {kind: "weekdays", startDate: "2026-11-16", weekdays: [2, 4]},
    recurrenceTimezone: "America/Sao_Paulo",
  });
  const before = planned([r]);
  assert.equal(before.notifications.length, 4);
  const after = planned([{...r, paused: true}]);
  assert.equal(after.notifications.length, 0);
  const changes = reconcileMedicationNotifications(before.notifications, after.notifications);
  assert.deepEqual(changes.obsolete.map(x => x.id).sort(), before.notifications.map(x => x.id).sort());
  assert.equal(changes.next.length, 0);
  assert.equal(changes.kept, 0);
});

test("retomar uma rotina ativa recria apenas os lembretes futuros", () => {
  const r = routine({id: "resume-test"});
  const stopped = planned([{...r, paused: true}]);
  const resumed = planned([r]);
  const changes = reconcileMedicationNotifications(stopped.notifications, resumed.notifications);
  assert.equal(changes.obsolete.length, 0);
  assert.equal(changes.next.length, 2);
  assert.deepEqual(changes.next.map(x => x.id), resumed.notifications.map(x => x.id));
});

test("tratamento encerrado remove inclusive repetições que já estavam agendadas", () => {
  const r = routine({
    id: "ended-test",
    recurrenceRule: {kind: "daily", startDate: "2026-11-01"},
    recurrenceTimezone: "America/Sao_Paulo",
  });
  const before = planned([r]);
  assert.equal(before.notifications.length, 2);
  const after = planned([{...r, recurrenceRule: {
    kind: "daily", startDate: "2026-11-01", endDate: "2026-11-16",
  }}]);
  assert.equal(after.notifications.length, 0);
  const changes = reconcileMedicationNotifications(before.notifications, after.notifications);
  assert.deepEqual(changes.obsolete.map(n=>n.id).sort(), before.notifications.map(n=>n.id).sort());
  assert.equal(changes.next.length, 0);
});

test("tratamento com fim hoje não agenda amanhã nem repete indefinidamente", () => {
  const r = routine({
    id: "last-day-test", time: "18:00", limit: "19:00",
    recurrenceRule: {kind: "daily", startDate: "2026-11-01", endDate: "2026-11-17"},
    recurrenceTimezone: "America/Sao_Paulo",
  });
  const today = planned([r]);
  assert.equal(today.notifications.length, 2);
  assert.ok(today.notifications.every(n=>n.schedule.at && !n.schedule.repeats));
  const tomorrow = planned([r], new Date("2026-11-18T15:00:00Z"));
  assert.equal(tomorrow.notifications.length, 0);
  assert.equal(reconcileMedicationNotifications(today.notifications, tomorrow.notifications).obsolete.length, 2);
});

test("pausar uma rotina não cancela alarmes de outras rotinas nem de outros recursos", () => {
  const paused = routine({id: "paused-only"});
  const healthy = routine({
    id: "healthy-schedule",
    recurrenceRule: {kind: "interval", startDate: "2026-11-16", everyDays: 2},
    recurrenceTimezone: "America/Sao_Paulo",
  });
  const pending = [
    ...planned([paused, healthy]).notifications,
    {id: 11223344, extra: {app: "other-app", routineId: "paused-only"}},
  ];
  const after = planned([{...paused,paused:true},healthy]);
  const changes = reconcileMedicationNotifications(pending, after.notifications);
  const oldPausedIds = planned([paused]).notifications.map(x=>x.id);
  assert.deepEqual(changes.obsolete.map(x=>x.id).sort(), oldPausedIds.sort());
  assert.equal(changes.kept, after.notifications.length);
  assert.equal(changes.next.length, 0);
});

test("arquivamento e desativação de lembretes retiram eventos anteriores da fila", () => {
  const r=routine({id:"archive-test"});
  const old=planned([r]);
  for (const updated of [{...r,archivedAt:"2026-11-17T13:00:00Z"}, {...r,remindersEnabled:false}]) {
    const newPlan=planned([updated]);
    assert.equal(newPlan.notifications.length,0);
    assert.equal(reconcileMedicationNotifications(old.notifications,newPlan.notifications).obsolete.length,2);
  }
});

test("reconciliação preserva notificações de outros recursos e remove versões antigas", () => {
  const r=routine({id:"compat"});
  const plan=planned([r]);
  const old={id:98765,extra:{routineId:"compat",kind:"reminder"}};
  const foreign={id:34567,extra:{app:"other-product",routineId:"compat",kind:"reminder"}};
  const changes=reconcileMedicationNotifications([old,foreign,...plan.notifications],plan.notifications);
  assert.deepEqual(changes.obsolete,[{id:98765}]);
  assert.equal(changes.kept,2);
  assert.equal(changes.next.length,0);
  assert.equal(isRoutineMedicationNotification(old,"compat"),true);
  assert.equal(isRoutineMedicationNotification(foreign,"compat"),false);
  assert.equal(isRoutineMedicationNotification(plan.notifications[0],"other"),false);
});
