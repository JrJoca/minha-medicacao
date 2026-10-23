import type { CatalogRead } from "./medication-catalog";

export type RoutineRecord = {
  id: string;
  name: string;
  period_description: string;
  scheduled_time: string;
  deadline_time: string;
  has_no_end_date: boolean;
  duration_value: number | null;
  duration_unit: "days" | "weeks" | null;
  total_days: number | null;
  current_day: number;
  status: "active" | "paused";
  stock_tracking_enabled?: boolean;
  frequency_kind?: "daily" | "other" | null;
  archived_at?: string | null;
};

type RoutineQueries = {
  all: () => PromiseLike<CatalogRead>;
  links: () => PromiseLike<CatalogRead>;
  byIds: (ids: string[]) => PromiseLike<CatalogRead>;
};

function records(result: CatalogRead): RoutineRecord[] {
  if (result.error || !Array.isArray(result.data)) throw new Error("routine-read");
  if (!result.data.every(row => row && typeof row.id === "string" &&
    typeof row.name === "string" && typeof row.scheduled_time === "string" &&
    typeof row.deadline_time === "string" && typeof row.has_no_end_date === "boolean" &&
    (row.status === "active" || row.status === "paused"))) throw new Error("routine-shape");
  return result.data;
}

export async function readRoutineCatalog(queries: RoutineQueries) {
  const rows = records(await queries.all());
  if (rows.length) return { rows, recoveredFromLinks: false };
  const linked = await queries.links();
  if (linked.error || !Array.isArray(linked.data) ||
    !linked.data.every(id => typeof id === "string" && id.length)) throw new Error("routine-links");
  const ids = [...new Set(linked.data as string[])];
  if (!ids.length) return { rows: [], recoveredFromLinks: false };
  const recovered = records(await queries.byIds(ids));
  const visible = new Set(recovered.map(row => row.id));
  if (!ids.every(id => visible.has(id))) throw new Error("routine-incomplete");
  return { rows: recovered, recoveredFromLinks: true };
}
