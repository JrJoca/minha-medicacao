/**
 * Calendário de recorrência de tomadas.
 *
 * O domínio trabalha com datas civis YYYY-MM-DD, não timestamps.
 * Um dia é definido pelo fuso escolhido no momento da ocorrência;
 * a conversão de instante -> dia local fica fora deste módulo.
 * UTC aqui é usado exclusivamente para aritmética de calendário,
 * evitando saltos causados por horário de verão.
 *
 * Importante: este módulo não altera tomadas, estoque nem dados antigos.
 * Regras legadas de frequência textual não devem ser convertidas implicitamente.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type RecurrenceBase = {
  startDate: string;
  endDate?: string | null;
};

export type RecurrenceRule =
  | (RecurrenceBase & { kind: "daily" })
  | (RecurrenceBase & { kind: "weekdays"; weekdays: Weekday[] })
  | (RecurrenceBase & { kind: "interval"; everyDays: number });

const MS_PER_DAY = 86_400_000;
const DEFAULT_HORIZON_DAYS = 365 * 5;
const MAX_HORIZON_DAYS = 365 * 30;

/** Converte uma data civil válida em um índice de dias, independentemente de TZ. */
function dayNumber(dateKey: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new RangeError("Data deve usar o formato YYYY-MM-DD.");
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  if (year < 1900 || year > 9999) {
    throw new RangeError("Ano fora do intervalo permitido (1900-9999).");
  }
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError("Data civil inválida.");
  }
  return timestamp / MS_PER_DAY;
}

function dateKeyFromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function validateRecurrence(rule: RecurrenceRule): void {
  if (!rule || typeof rule !== "object") {
    throw new TypeError("Informe uma recorrência.");
  }
  const start = dayNumber(rule.startDate);
  if (rule.endDate !== undefined && rule.endDate !== null) {
    if (dayNumber(rule.endDate) < start) {
      throw new RangeError("O fim do tratamento não pode anteceder o início.");
    }
  }

  if (rule.kind === "daily") return;

  if (rule.kind === "weekdays") {
    if (
      !Array.isArray(rule.weekdays) ||
      rule.weekdays.length === 0 ||
      rule.weekdays.length > 7 ||
      rule.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(rule.weekdays).size !== rule.weekdays.length
    ) {
      throw new RangeError("Selecione dias da semana únicos entre domingo (0) e sábado (6).");
    }
    return;
  }

  if (rule.kind === "interval") {
    if (!Number.isSafeInteger(rule.everyDays) || rule.everyDays < 1 || rule.everyDays > 3650) {
      throw new RangeError("O intervalo deve ser de 1 a 3650 dias.");
    }
    return;
  }

  throw new RangeError("Tipo de recorrência não suportado.");
}

function matchesValidated(rule: RecurrenceRule, day: number, start: number): boolean {
  if (day < start || (rule.endDate && day > dayNumber(rule.endDate))) return false;
  switch (rule.kind) {
    case "daily": return true;
    case "weekdays": return rule.weekdays.includes(new Date(day * MS_PER_DAY).getUTCDay() as Weekday);
    case "interval": return (day - start) % rule.everyDays === 0;
  }
}

/**
 * Indica se existe dose prevista para esta data, sem considerar confirmação.
 * Ausência de ocorrência não equivale a "não tomado".
 */
export function isScheduledOn(rule: RecurrenceRule, dateKey: string): boolean {
  validateRecurrence(rule);
  return matchesValidated(rule, dayNumber(dateKey), dayNumber(rule.startDate));
}

/**
 * Próxima data com ocorrência, incluindo fromDate.
 * null = nenhuma ocorrência dentro do horizonte consultado ou após endDate.
 * Não presume uma recorrência para rotinas antigas sem regra explícita.
 */
export function nextScheduledDate(
  rule: RecurrenceRule,
  fromDate: string,
  horizonDays = DEFAULT_HORIZON_DAYS,
): string | null {
  validateRecurrence(rule);
  if (!Number.isSafeInteger(horizonDays) || horizonDays < 0 || horizonDays > MAX_HORIZON_DAYS) {
    throw new RangeError("Horizonte de consulta inválido.");
  }
  const from = dayNumber(fromDate);
  const start = dayNumber(rule.startDate);
  const last = Math.min(
    from + horizonDays,
    rule.endDate ? dayNumber(rule.endDate) : Infinity,
    dayNumber("9999-12-31"),
  );
  for (let day = Math.max(from, start); day <= last; day += 1) {
    if (matchesValidated(rule, day, start)) return dateKeyFromDay(day);
  }
  return null;
}

/** Encerramento por data civil explícita, sem arquivar nem modificar o banco. */
export function treatmentEnded(rule: RecurrenceRule, onDate: string): boolean {
  validateRecurrence(rule);
  return !!rule.endDate && dayNumber(onDate) > dayNumber(rule.endDate);
}


/** Aritmética por datas civis, sem somar 24h ao relógio do dispositivo. */
export function addCalendarDays(dateKey: string, days: number): string {
  if (!Number.isSafeInteger(days) || Math.abs(days) > 365 * 100) {
    throw new RangeError("Intervalo de dias inválido.");
  }
  const key = dateKeyFromDay(dayNumber(dateKey) + days);
  dayNumber(key);
  return key;
}

export function calendarDaysBetween(startDate: string, endDate: string): number {
  return dayNumber(endDate) - dayNumber(startDate);
}

/** Interpreta um instante na zona IANA da rotina (sem depender da zona do dispositivo). */
export function dateKeyInTimezone(instant: Date, timezone: string): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new RangeError("Instante inválido.");
  }
  const fields = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const find = (kind: string) => fields.find(part => part.type === kind)?.value;
  const key = [find("year"),find("month"),find("day")].join("-");
  dayNumber(key);
  return key;
}

/** Converte uma hora civil de uma zona IANA em um Date real; rejeita horas inexistentes no DST. */
export function dateTimeInTimezone(day: string, time: string, timezone: string): Date | null {
  const date = dayNumber(day);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  const expectedMs = date * MS_PER_DAY + hour * 3_600_000 + minute * 60_000;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hourCycle:"h23",
  });
  let guess = expectedMs;
  for (let pass=0;pass<5;pass++) {
    const parts=formatter.formatToParts(new Date(guess));
    const field=(kind:string) => Number(parts.find(p=>p.type===kind)?.value);
    const observed = Date.UTC(field("year"),field("month")-1,field("day"),field("hour"),field("minute"));
    const difference = expectedMs-observed;
    if (difference===0) return new Date(guess);
    guess+=difference;
  }
  return null;
}
