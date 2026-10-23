export function dashboardClock(date: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
  const hour = Number(part("hour"));
  return {
    dayKey: `${part("year")}-${part("month")}-${part("day")}`,
    minutes: hour * 60 + Number(part("minute")),
    label: new Intl.DateTimeFormat("pt-BR", {
      timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric",
    }).format(date),
    greeting: hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite",
  };
}
