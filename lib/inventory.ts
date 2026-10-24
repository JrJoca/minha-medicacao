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

export type MedicationPurchase = {
  id: string;
  medication_id: string;
  quantity: number;
  unit: QuantityUnit;
  purchased_on: string;
  pharmacy: string;
  reference_url: string | null;
  revision?: string;
};
export type PurchaseDraft = { quantity: string; purchased_on: string; pharmacy: string; reference_url: string };
export type PurchaseCorrectionDraft = PurchaseDraft & {reason: string};
export function localDay(date: Date) {
  return String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}
export function parsePurchase(draft: PurchaseDraft, today: string) {
  const quantity = parseQuantity(draft.quantity, true);
  if (quantity === null) throw new Error("Informe a quantidade comprada.");
  const date = new Date(draft.purchased_on + "T12:00:00");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.purchased_on) || !Number.isFinite(date.getTime()) ||
    localDay(date) !== draft.purchased_on || draft.purchased_on > today) throw new Error("Informe uma data de compra válida, até hoje.");
  const pharmacy = draft.pharmacy.trim();
  if (!pharmacy || pharmacy.length > 160) throw new Error("Informe a farmácia, com até 160 caracteres.");
  let reference_url: string | null = null;
  if (draft.reference_url.trim()) {
    let url: URL;
    try { url = new URL(draft.reference_url.trim()); }
    catch { throw new Error("Use um link válido começando com http ou https."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error("Use um link http ou https sem credenciais.");
    reference_url = url.href;
  }
  return {quantity, purchased_on: draft.purchased_on, pharmacy, reference_url};
}

export function purchaseDraft(purchase: MedicationPurchase): PurchaseDraft {
  return {quantity:String(purchase.quantity),purchased_on:purchase.purchased_on,pharmacy:purchase.pharmacy,reference_url:purchase.reference_url || ""};
}
export function normalizePurchase(purchase: MedicationPurchase) {
  return {...purchase,quantity:Number(purchase.quantity),revision:purchase.revision == null ? undefined : String(purchase.revision)};
}
export function parsePurchaseCorrection(draft: PurchaseCorrectionDraft, today: string) {
  const purchase = parsePurchase(draft,today);
  const reason = draft.reason.trim();
  if (!reason || Array.from(reason).length > 500) throw new Error("Informe o motivo da correção, com até 500 caracteres.");
  return {...purchase,reason};
}
