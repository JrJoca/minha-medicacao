export type QuantityUnit = "tablet" | "ml";
export type RoutineDose = { quantity: string; unit: QuantityUnit };
export type Inventory = {
  medication_id: string;
  quantity: number | null;
  quantity_per_package: number | null;
  unit: QuantityUnit | null;
  daily_quantity: number | null;
  estimated_days: number | null;
  full_days_covered: number | null;
};
export function parseQuantity(text: string, positive = false): number | null {
  if (!text.trim()) return null;
  const normalized = text.trim().replace(",", ".");
  const value = Number(normalized);
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized) || !Number.isFinite(value) || value > 999999999.999 || (positive && value <= 0)) throw new Error("Use uma quantidade válida com até 3 casas decimais.");
  return value;
}
export function unitLabel(unit: QuantityUnit | null | undefined) { return unit === "ml" ? "ml" : unit === "tablet" ? "comprimidos" : "unidades"; }
export function normalizeInventory(row: Inventory): Inventory {
  const numeric = (key: keyof Inventory) => row[key] == null ? null : Number(row[key]);
  return {...row,quantity:numeric("quantity"),quantity_per_package:numeric("quantity_per_package"),daily_quantity:numeric("daily_quantity"),estimated_days:numeric("estimated_days"),full_days_covered:numeric("full_days_covered")};
}
