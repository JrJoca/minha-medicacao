import type { QuantityUnit, RoutineDose } from "./inventory";
import { dateKeyInTimezone, dateTimeInTimezone, addCalendarDays, isScheduledOn, validateRecurrence, type RecurrenceRule } from "./recurrence.ts";

export type ForecastRoutine = {
  recurrenceRule?: RecurrenceRule | null;
  recurrenceTimezone?: string | null;
  id: string;
  medicineIds: string[];
  doses: Record<string, RoutineDose>;
  time: string;
  paused: boolean;
  archivedAt: string | null;
  stockTracking: boolean;
  frequencyKind: "daily" | "other" | null;
  noEndDate: boolean;
  currentDay: number;
  totalDays: number | null;
  taken: boolean;
  takenAt: string | null;
};
export type StockForecastResult = {
  state: "forecast" | "covered" | "missing_balance" | "missing_doses" | "no_routines" | "out_of_range";
  dailyQuantity: number | null;
  lastCovered: Date | null;
  firstUncovered: Date | null;
};

const dayKey = (date: Date) => [date.getFullYear(), date.getMonth(), date.getDate()].join("-");
const thousandths = (value: number) => Math.round(value * 1000);

// Simula ocorrências no calendário local, sem percorrer dia a dia estoques grandes.
// As tomadas confirmadas hoje já foram descontadas do saldo e não são projetadas de novo.
function legacyForecastStock(
  medicationId: string, quantity: number | null, unit: QuantityUnit | null,
  routines: ForecastRoutine[], now: Date,
): StockForecastResult {
  const empty = (state: StockForecastResult["state"]): StockForecastResult =>
    ({state, dailyQuantity: null, lastCovered: null, firstUncovered: null});
  if (quantity === null || !Number.isFinite(quantity) || !unit) return empty("missing_balance");
  const relevant = routines.filter(r => !r.paused && !r.archivedAt && r.medicineIds.includes(medicationId));
  if (!relevant.length) return empty("no_routines");
  const plans: {id: string; time: string; amount: number; days: number; confirmed: boolean}[] = [];
  for (const r of relevant) {
    const dose = r.doses[medicationId];
    const value = Number(dose?.quantity.replace(",", "."));
    if (!r.stockTracking || r.frequencyKind !== "daily" || !dose?.quantity.trim() ||
      dose.unit !== unit || !Number.isFinite(value) || value <= 0 ||
      !/^\d+(?:[.,]\d{1,3})?$/.test(dose.quantity.trim()) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) return empty("missing_doses");
    const days = r.noEndDate ? Infinity : r.totalDays === null ? NaN : r.totalDays - r.currentDay + 1;
    if (!(days > 0) || (!r.noEndDate && !Number.isSafeInteger(days))) return empty("missing_doses");
    plans.push({id: r.id, time: r.time, amount: thousandths(value), days,
      confirmed: r.taken && !!r.takenAt && dayKey(new Date(r.takenAt)) === dayKey(now)});
  }
  plans.sort((a,b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  const daily = plans.reduce((sum, p) => sum + p.amount, 0);
  if (!Number.isSafeInteger(daily) || !daily) return empty("out_of_range");
  const result: StockForecastResult = {state: "forecast", dailyQuantity: daily / 1000, lastCovered: null, firstUncovered: null};
  let balance = Math.max(0, thousandths(quantity));
  const dateAt = (day: number, time: string) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + day);
    const [hour, minute] = time.split(":").map(Number);
    date.setHours(hour, minute, 0, 0);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const consume = (day: number, plan: typeof plans[number]) => {
    const at = dateAt(day, plan.time);
    if (!at) { result.state = "out_of_range"; return false; }
    if (balance < plan.amount) { result.firstUncovered = at; return false; }
    balance -= plan.amount;
    result.lastCovered = at;
    return true;
  };
  for (const plan of plans.filter(p => !p.confirmed)) if (!consume(0, plan)) return result;
  let day = 1;
  while (true) {
    const active = plans.filter(p => day < p.days);
    if (!active.length) return {...result, state: "covered"};
    const dailyAmount = active.reduce((sum, p) => sum + p.amount, 0);
    const boundary = Math.min(...active.map(p => p.days));
    const skip = Math.min(Math.floor(balance / dailyAmount), boundary - day);
    if (skip > 0) {
      const last = dateAt(day + skip - 1, active[active.length - 1].time);
      if (!last) return {...result, state: "out_of_range"};
      result.lastCovered = last;
      balance -= skip * dailyAmount;
      day += skip;
    }
    if (day >= boundary) continue;
    for (const plan of active) if (!consume(day, plan)) return result;
    day++;
  }
}

export function formatForecastDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {dateStyle: "short", timeStyle: "short"}).format(date);
}


/**
 * Projeção em ordem cronológica de ocorrências estruturadas.
 * Rotinas legadas diárias mantêm a lógica anterior sem mudanças retroativas.
 * Quando uma regra não permite cálculo confiável, retornamos um motivo, nunca
 * inventamos uma data de reposição.
 */
export function forecastStock(
  medicationId: string, quantity: number | null, unit: QuantityUnit | null,
  routines: ForecastRoutine[], now: Date,
): StockForecastResult {
  const relevant = routines.filter(r => !r.paused && !r.archivedAt && r.medicineIds.includes(medicationId));
  if (!relevant.some(r => r.recurrenceRule)) {
    return legacyForecastStock(medicationId, quantity, unit, routines, now);
  }
  const empty = (state: StockForecastResult["state"]): StockForecastResult =>
    ({state,dailyQuantity:null,lastCovered:null,firstUncovered:null});
  if (quantity === null || !Number.isFinite(quantity) || !unit) return empty("missing_balance");
  if (!relevant.length) return empty("no_routines");
  if (!Number.isFinite(now.getTime())) return empty("out_of_range");
  type Plan = {id:string;amount:number;time:string;timezone:string;start:string;days:number;
    rule:RecurrenceRule | null;confirmedToday:boolean};
  const plans:Plan[]=[];
  try {
    for (const r of relevant) {
      const dose=r.doses[medicationId];
      const amount=Number(dose?.quantity.replace(",","."));
      if (!r.stockTracking || !dose?.quantity.trim() || dose.unit!==unit ||
          !/^\d+(?:[.,]\d{1,3})?$/.test(dose.quantity.trim()) ||
          !Number.isFinite(amount) || amount<=0 ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) return empty("missing_doses");
      if (!r.recurrenceRule && r.frequencyKind!=="daily") return empty("missing_doses");
      if (r.recurrenceRule) validateRecurrence(r.recurrenceRule);
      const timezone=r.recurrenceRule ? r.recurrenceTimezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timezone) return empty("missing_doses");
      const start=dateKeyInTimezone(now,timezone);
      const days=r.recurrenceRule ? Infinity :
        (r.noEndDate ? Infinity : r.totalDays === null ? NaN : r.totalDays-r.currentDay+1);
      if (!r.recurrenceRule && (!(days>0) || (!r.noEndDate && !Number.isSafeInteger(days)))) return empty("missing_doses");
      const confirmedToday=!!r.takenAt && r.taken &&
        dateKeyInTimezone(new Date(r.takenAt),timezone)===start;
      plans.push({id:r.id,amount:thousandths(amount),time:r.time,timezone,start,days,rule:r.recurrenceRule||null,confirmedToday});
    }
  } catch {
    return empty("missing_doses");
  }
  const dailyQuantity=plans.every(p => !p.rule || p.rule.kind==="daily") ?
    plans.reduce((sum,p)=>sum+p.amount,0)/1000 : null;
  let remaining=thousandths(Math.max(0,quantity));
  if (!Number.isSafeInteger(remaining) || plans.some(p=>!Number.isSafeInteger(p.amount)||p.amount<=0)) {
    return empty("out_of_range");
  }

  // 6 anos: limite operacional explícito para não iterar sobre estoques enormes.
  const horizon=366*6;
  const events:{id:string;amount:number;at:Date}[]=[];
  let hasScheduleAfterHorizon=false;
  try {
    for (const p of plans) {
      for(let offset=0;offset<=horizon;offset++) {
        const dateKey=addCalendarDays(p.start,offset);
        if (p.rule) {
          if (!isScheduledOn(p.rule,dateKey)) continue;
        } else if(offset>=p.days) continue;
        if (offset===0 && p.confirmedToday) continue;
        const at=dateTimeInTimezone(dateKey,p.time,p.timezone);
        if (!at) return empty("out_of_range");
        events.push({id:p.id,amount:p.amount,at});
      }
      if (!p.rule || !p.rule.endDate || p.rule.endDate > addCalendarDays(p.start,horizon)) {
        if (p.days > horizon) hasScheduleAfterHorizon=true;
      }
    }
  } catch {
    return empty("out_of_range");
  }
  events.sort((a,b)=>a.at.getTime()-b.at.getTime()||a.id.localeCompare(b.id));
  let lastCovered:Date|null=null;
  for(const event of events) {
    if (remaining<event.amount) {
      return {state:"forecast",dailyQuantity,lastCovered,firstUncovered:event.at};
    }
    remaining-=event.amount;
    lastCovered=event.at;
  }
  return {state:hasScheduleAfterHorizon?"out_of_range":"covered",dailyQuantity,lastCovered,firstUncovered:null};
}
