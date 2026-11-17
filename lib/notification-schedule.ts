import {
  addCalendarDays,
  dateKeyInTimezone,
  dateTimeInTimezone,
  isScheduledOn,
  validateRecurrence,
  type RecurrenceRule,
} from "./recurrence.ts";

/**
 * Agendamento puro para o plugin @capacitor/local-notifications.
 * O "on" do Capacitor usa o fuso local DO DISPOSITIVO: só utilizamos a
 * repetição nativa quando ele coincide com o fuso da rotina.
 *
 * Datas limitadas, início futuro e intervalos N>1 usam datas absolutas.
 * Essas datas são reabastecidas em abertura/retomada da aplicação.
 */
export type NotificationRoutine = {
  id: string;
  name: string;
  time: string;
  limit: string;
  paused: boolean;
  archivedAt?: string | null;
  frequencyKind?: "daily" | "other" | null;
  recurrenceRule?: RecurrenceRule | null;
  recurrenceTimezone?: string | null;
};

export type PlannedNotification = {
  id: number;
  title: string;
  body: string;
  schedule: {
    at?: Date;
    on?: { weekday?: 1 | 2 | 3 | 4 | 5 | 6 | 7; hour: number; minute: number };
    repeats?: boolean;
    allowWhileIdle: true;
  };
  extra: {
    app: "minha-medicacao";
    version: 2;
    routineId: string;
    kind: "reminder" | "deadline";
    signature: string;
  };
};

export type NotificationPlan = {
  notifications: PlannedNotification[];
  truncated: boolean;
  skipped: number;
};

/** Limite conservador: 64 pendências é o teto conhecido para iOS. */
export const MAX_PENDING_NOTIFICATIONS = 60;
export const NOTIFICATION_LOOKAHEAD_DAYS = 120;

function hash32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function notificationId(key: string, used: Set<number>): number {
  let id = (hash32(key) % 2_147_483_646) + 1;
  while (used.has(id)) id = (id % 2_147_483_646) + 1;
  used.add(id);
  return id;
}

function timeParts(value: string): { hour: number; minute: number } | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

type Candidate = {
  key: string;
  routineId: string;
  title: string;
  body: string;
  kind: "reminder" | "deadline";
  when?: Date;
  on?: { weekday?: 1 | 2 | 3 | 4 | 5 | 6 | 7; hour: number; minute: number };
  signature: string;
};

function makeCandidate(
  routine: NotificationRoutine,
  kind: "reminder" | "deadline",
  time: string,
  suffix: string,
  when?: Date,
  on?: Candidate["on"],
): Candidate {
  const title = kind === "reminder" ? routine.name : "Prazo da rotina: " + routine.name;
  const body = kind === "reminder"
    ? "Está na hora de realizar sua rotina de medicação."
    : "Este é o horário limite configurado para a rotina.";
  const key = routine.id + "|" + kind + "|" + suffix;
  const fingerprint = hash32([title, body, time, suffix].join("|")).toString(16);
  return { key, routineId: routine.id, title, body, kind, when, on, signature: fingerprint };
}

/**
 * Mantém a compatibilidade dos alarmes diários legados, sem assumir que
 * "other" ou frequências antigas desconhecidas significam "todo dia".
 */
export function buildNotificationPlan(
  routines: NotificationRoutine[],
  now: Date = new Date(),
  deviceTimezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): NotificationPlan {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Relógio inválido.");
  const repeated: Candidate[] = [];
  const dated: Candidate[] = [];
  let skipped = 0;

  for (const routine of routines) {
    if (routine.paused || routine.archivedAt) continue;
    const reminder = timeParts(routine.time);
    const deadline = timeParts(routine.limit);
    if (!reminder || !deadline) { skipped++; continue; }

    const rule = routine.recurrenceRule || null;
    const kinds = [
      { kind: "reminder" as const, time: routine.time, parts: reminder },
      { kind: "deadline" as const, time: routine.limit, parts: deadline },
    ];

    if (!rule) {
      if (routine.frequencyKind === "other") { skipped++; continue; }
      for (const part of kinds) {
        repeated.push(makeCandidate(
          routine, part.kind, part.time, "legacy-daily",
          undefined, { ...part.parts },
        ));
      }
      continue;
    }

    try {
      validateRecurrence(rule);
      const timezone = routine.recurrenceTimezone;
      if (!timezone) { skipped++; continue; }
      const today = dateKeyInTimezone(now, timezone);
      // Uma regra sem fim, já iniciada e no fuso do aparelho pode ficar
      // repetindo no próprio SO, sem precisar abrir o app para renovação.
      const nativeRepeat =
        !rule.endDate &&
        rule.startDate <= today &&
        timezone === deviceTimezone &&
        (rule.kind === "daily" || rule.kind === "weekdays" ||
          (rule.kind === "interval" && (rule.everyDays === 1 || rule.everyDays === 7)));

      if (nativeRepeat) {
        // A cada sete dias equivale a uma repetição semanal ancorada no
        // dia de início. Não fazer essa conversão para 14, 21 ou 30 dias.
        const weekdays = rule.kind === "weekdays" ? [...rule.weekdays].sort()
          : rule.kind === "interval" && rule.everyDays === 7
            ? [new Date(rule.startDate + "T00:00:00Z").getUTCDay()]
            : [null];
        for (const weekday of weekdays) {
          for (const part of kinds) {
            // Calendário: 0=Dom; Capacitor: 1=Dom ... 7=Sáb.
            const on = weekday === null
              ? { ...part.parts }
              : { ...part.parts, weekday: (weekday + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 };
            repeated.push(makeCandidate(
              routine, part.kind, part.time,
              weekday === null ? "daily" : "weekday:" + weekday,
              undefined, on,
            ));
          }
        }
        continue;
      }

      // Agenda absoluta: respeita data inicial, fim, fuso e intervalo.
      for (let offset = 0; offset <= NOTIFICATION_LOOKAHEAD_DAYS; offset++) {
        const date = addCalendarDays(today, offset);
        if (rule.endDate && date > rule.endDate) break;
        if (!isScheduledOn(rule, date)) continue;
        for (const part of kinds) {
          const at = dateTimeInTimezone(date, part.time, timezone);
          // Horário inexistente na mudança de DST: não inventar outro horário.
          if (!at || at.getTime() <= now.getTime()) continue;
          dated.push(makeCandidate(
            routine, part.kind, part.time, date + "|" + timezone, at,
          ));
        }
      }
    } catch {
      // Recorrência ou fuso inválidos não devem gerar alarmes diários.
      skipped++;
    }
  }

  const available = Math.max(0, MAX_PENDING_NOTIFICATIONS - repeated.length);
  dated.sort((a, b) => (a.when?.getTime() || 0) - (b.when?.getTime() || 0) ||
    a.key.localeCompare(b.key));
  const selected = [
    ...repeated.slice(0, MAX_PENDING_NOTIFICATIONS),
    ...dated.slice(0, available),
  ];
  const used = new Set<number>();
  const notifications: PlannedNotification[] = selected.map(candidate => ({
    id: notificationId(candidate.key, used),
    title: candidate.title,
    body: candidate.body,
    schedule: candidate.when
      ? { at: candidate.when, allowWhileIdle: true }
      : { on: candidate.on!, repeats: true, allowWhileIdle: true },
    extra: {
      app: "minha-medicacao",
      version: 2,
      routineId: candidate.routineId,
      kind: candidate.kind,
      signature: candidate.signature,
    },
  }));
  return {
    notifications,
    truncated: repeated.length + dated.length > MAX_PENDING_NOTIFICATIONS,
    skipped,
  };
}

/** Reconhece também as notificações das versões anteriores para removê-las. */
export function isMedicationNotification(
  pending: { extra?: unknown },
): boolean {
  const extra = pending.extra;
  if (!extra || typeof extra !== "object") return false;
  const obj = extra as Record<string, unknown>;
  return obj.app === "minha-medicacao" ||
    (typeof obj.routineId === "string" &&
      (obj.kind === "reminder" || obj.kind === "deadline"));
}
