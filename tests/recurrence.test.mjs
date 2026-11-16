import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isScheduledOn,
  nextScheduledDate,
  treatmentEnded,
  validateRecurrence,
} from "../lib/recurrence.ts";

const daily = { kind: "daily", startDate: "2026-11-16", endDate: null };

test("diária começa na data definida e não cria faltas antes do início", () => {
  assert.equal(isScheduledOn(daily, "2026-11-15"), false);
  assert.equal(isScheduledOn(daily, "2026-11-16"), true);
  assert.equal(isScheduledOn(daily, "2026-11-17"), true);
  assert.equal(nextScheduledDate(daily, "2026-11-15"), "2026-11-16");
});

test("dias da semana são calculados por calendário civil, não por horários UTC locais", () => {
  // 16/11/2026 é segunda-feira. 17/11 é terça, 19/11 é quinta.
  const rule = {
    kind: "weekdays",
    startDate: "2026-11-16",
    weekdays: [2, 4],
    endDate: null,
  };
  assert.equal(isScheduledOn(rule, "2026-11-16"), false);
  assert.equal(isScheduledOn(rule, "2026-11-17"), true);
  assert.equal(isScheduledOn(rule, "2026-11-18"), false);
  assert.equal(nextScheduledDate(rule, "2026-11-18"), "2026-11-19");
  assert.equal(nextScheduledDate(rule, "2026-11-20"), "2026-11-24");
});

test("intervalo de N dias usa a data inicial como âncora", () => {
  const rule = { kind: "interval", startDate: "2026-11-16", everyDays: 3 };
  assert.equal(isScheduledOn(rule, "2026-11-16"), true);
  assert.equal(isScheduledOn(rule, "2026-11-18"), false);
  assert.equal(isScheduledOn(rule, "2026-11-19"), true);
  assert.equal(nextScheduledDate(rule, "2026-11-20"), "2026-11-22");
});

test("fim do tratamento é inclusivo; não prevê tomadas depois", () => {
  const rule = { ...daily, endDate: "2026-11-18" };
  assert.equal(isScheduledOn(rule, "2026-11-18"), true);
  assert.equal(isScheduledOn(rule, "2026-11-19"), false);
  assert.equal(nextScheduledDate(rule, "2026-11-19"), null);
  assert.equal(treatmentEnded(rule, "2026-11-18"), false);
  assert.equal(treatmentEnded(rule, "2026-11-19"), true);
});

test("fevereiro bissexto e virada do ano não perdem dias", () => {
  const rule = { kind: "interval", startDate: "2028-02-28", everyDays: 2 };
  assert.equal(nextScheduledDate(rule, "2028-02-29"), "2028-03-01");
  assert.equal(nextScheduledDate({ ...daily, startDate: "2026-12-31" }, "2027-01-01"), "2027-01-01");
});

test("recorrência semanal com fim não produz data além do tratamento", () => {
  const rule = { kind: "weekdays", startDate: "2026-11-16", weekdays: [1], endDate: "2026-11-18" };
  assert.equal(nextScheduledDate(rule, "2026-11-17"), null);
  assert.equal(nextScheduledDate(rule, "2026-11-16"), "2026-11-16");
});

test("entrada inválida é recusada em vez de inventar recorrência", () => {
  for (const bad of [
    { ...daily, startDate: "2026-02-29" },
    { ...daily, startDate: "2026-11-31" },
    { ...daily, endDate: "2026-11-15" },
    { kind: "weekdays", startDate: "2026-11-16", weekdays: [] },
    { kind: "weekdays", startDate: "2026-11-16", weekdays: [1, 1] },
    { kind: "weekdays", startDate: "2026-11-16", weekdays: [7] },
    { kind: "interval", startDate: "2026-11-16", everyDays: 0 },
    { kind: "interval", startDate: "2026-11-16", everyDays: 1.5 },
    { kind: "other", startDate: "2026-11-16" },
  ]) {
    assert.throws(() => validateRecurrence(bad));
  }
  assert.throws(() => nextScheduledDate(daily, "2026-11-16", -1));
  assert.equal(nextScheduledDate({ kind: "interval", startDate: "2026-11-16", everyDays: 20 }, "2026-11-17", 2), null);
});
