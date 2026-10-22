export type StockInput = {
  total_tablets: number | null;
  tablets_per_box: number | null;
  tablets_per_day: number | null;
};

export type MedicationStock = StockInput & {
  medication_id: string;
  user_id: string;
  estimated_days: number | null;
  full_days_covered: number | null;
};

export type StockField = keyof StockInput;
export type StockDraft = Record<StockField, string>;
export type StockErrors = Partial<Record<StockField, string>>;

export const stockFields = [
  { key: "total_tablets", label: "Total de comprimidos disponíveis", min: 0 },
  { key: "tablets_per_box", label: "Comprimidos por caixa", min: 1 },
  { key: "tablets_per_day", label: "Comprimidos por dia", min: 1 },
] as const;

export function stockDraft(stock?: MedicationStock): StockDraft {
  return {
    total_tablets: String(stock?.total_tablets ?? ""),
    tablets_per_box: String(stock?.tablets_per_box ?? ""),
    tablets_per_day: String(stock?.tablets_per_day ?? ""),
  };
}

export function parseStockDraft(draft: StockDraft) {
  const values: StockInput = { total_tablets: null, tablets_per_box: null, tablets_per_day: null };
  const errors: StockErrors = {};
  for (const { key, min } of stockFields) {
    const text = draft[key].trim();
    if (!text) continue;
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > 2_147_483_647) {
      errors[key] = min === 0
        ? "Informe um número inteiro entre 0 e 2.147.483.647."
        : "Informe um número inteiro entre 1 e 2.147.483.647.";
    } else {
      values[key] = value;
    }
  }
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

// Prévia local. Depois de salvar, o cartão usa os resultados gerados pelo Neon.
export function estimateStock(values: StockInput) {
  const { total_tablets: total, tablets_per_day: daily } = values;
  if (total === null || daily === null || !Number.isInteger(total) || !Number.isInteger(daily) || total < 0 || daily <= 0) {
    return { estimated_days: null, full_days_covered: null };
  }
  return { estimated_days: total / daily, full_days_covered: Math.floor(total / daily) };
}

export function formatStockQuantity(value: number | null | undefined) {
  return value == null ? "Não informado" : new Intl.NumberFormat("pt-BR").format(value);
}

export function formatStockDuration(days: number | null | undefined) {
  if (days == null || !Number.isFinite(days) || days < 0) return "Sem previsão";
  if (days > 0 && days < 1) return "Menos de 1 dia";
  const value = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(days);
  return `${Number.isInteger(days) ? "" : "Aprox. "}${value} ${value === "1" ? "dia" : "dias"}`;
}

export function normalizeStock(row: Omit<MedicationStock, "estimated_days"> & { estimated_days: number | string | null }): MedicationStock {
  const days = row.estimated_days === null ? null : Number(row.estimated_days);
  if (days !== null && (!Number.isFinite(days) || days < 0)) throw new Error("Previsão de estoque inválida.");
  return { ...row, estimated_days: days };
}
