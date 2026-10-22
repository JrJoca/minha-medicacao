"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Package, Pencil, Pill, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBackend, type ApplicationUser } from "@/lib/neon";
import {
  estimateStock, formatStockDuration, formatStockQuantity, normalizeStock,
  parseStockDraft, stockDraft, stockFields,
  type MedicationStock, type StockDraft, type StockErrors,
} from "@/lib/medication-stock";

type Medicine = { id: string; name: string; dosage: string; link?: string };
const stockColumns = "medication_id,user_id,total_tablets,tablets_per_box,tablets_per_day,estimated_days,full_days_covered";

export function MedicationInventory({ medicines, user, dataLoading }: {
  medicines: Medicine[];
  user: ApplicationUser;
  dataLoading: boolean;
}) {
  const [stocks, setStocks] = useState<Record<string, MedicationStock>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StockDraft>(() => stockDraft());
  const [errors, setErrors] = useState<StockErrors>({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requestRevision = useRef(0);
  const mounted = useRef(false);
  const saveLock = useRef(false);
  const medicineIds = medicines.map(medicine => medicine.id).join(":");
  const canEdit = user.role === "owner";
  const selected = medicines.find(medicine => medicine.id === selectedId);
  const parsed = parseStockDraft(draft);
  const preview = parsed.valid ? estimateStock(parsed.values) : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const revision = ++requestRevision.current;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setLoadError("");
      try {
        const { data, error } = await getBackend().rpc("medication_stock_summary").abortSignal(controller.signal);
        if (error) throw error;
        if (controller.signal.aborted || revision !== requestRevision.current) return;
        const next: Record<string, MedicationStock> = {};
        for (const row of data ?? []) next[row.medication_id] = normalizeStock(row);
        setStocks(next);
      } catch {
        if (!controller.signal.aborted && revision === requestRevision.current) {
          setStocks({});
          setLoadError("Não foi possível carregar os estoques. Seus medicamentos e rotinas continuam disponíveis.");
        }
      } finally {
        if (!controller.signal.aborted && revision === requestRevision.current) setLoading(false);
      }
    });
    return () => { controller.abort(); };
  }, [medicineIds, user.authId, refresh]);

  function openStock(medicine: Medicine) {
    if (loading || loadError) return;
    setDraft(stockDraft(stocks[medicine.id]));
    setErrors({});
    setSaveError("");
    setMessage("");
    setSelectedId(medicine.id);
  }

  async function saveStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !selected || saveLock.current || loading || loadError) return;
    const result = parseStockDraft(draft);
    setErrors(result.errors);
    if (!result.valid) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError("");
    const medicine = selected;
    const revision = requestRevision.current;
    try {
      const { data, error } = await getBackend().from("medication_stock")
        .upsert({ medication_id: medicine.id, user_id: user.id, ...result.values }, { onConflict: "medication_id" })
        .select(stockColumns).single();
      if (error || !data) throw error || new Error("Estoque não confirmado.");
      const saved = normalizeStock(data);
      if (!mounted.current) return;
      if (revision === requestRevision.current) {
        setStocks(current => ({ ...current, [medicine.id]: saved }));
      } else {
        setRefresh(value => value + 1);
      }
      setSelectedId(null);
      setMessage(`Estoque de ${medicine.name} atualizado.`);
    } catch {
      if (mounted.current) setSaveError("Não foi possível salvar o estoque. Os valores foram mantidos para você tentar novamente.");
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const informed = medicines.filter(medicine => stocks[medicine.id]?.total_tablets != null).length;
  return (
    <section className="mb-8" aria-labelledby="medication-list-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="medication-list-title" className="text-xl font-bold">Medicamentos cadastrados</h2>
          <p className="mt-1 text-sm text-slate-500">Consulte seus medicamentos e acompanhe o estoque disponível.</p>
        </div>
        <Button type="button" variant="outline" disabled={loading || saving || dataLoading} onClick={() => setRefresh(value => value + 1)} className="h-10 rounded-xl bg-white">
          <RefreshCw className={loading ? "animate-spin" : ""} /> Atualizar saldos
        </Button>
      </div>
      <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-blue-900">
        <p className="font-semibold">O estoque reflete o saldo informado.</p>
        <p>As tomadas ainda não descontam comprimidos automaticamente. Mantenha o saldo atualizado ao conferir seus medicamentos.</p>
      </div>
      {loadError && <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p>{loadError}</p>
        <Button type="button" variant="outline" className="mt-3 rounded-xl bg-white" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</Button>
      </div>}
      {message && <p role="status" className="mb-4 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><Check className="mt-0.5 size-4 shrink-0" />{message}</p>}
      {!loading && !loadError && medicines.length > 0 && <p className="mb-3 text-sm text-slate-500">{informed} de {medicines.length} com saldo informado</p>}
      {medicines.length === 0 ? (
        <Card className="rounded-3xl border-dashed border-slate-300 bg-white">
          <CardContent className="text-sm text-slate-500">{dataLoading ? "Carregando medicamentos…" : "Nenhum medicamento cadastrado."}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {medicines.map(medicine => {
            const stock = stocks[medicine.id];
            const known = stock?.total_tablets != null;
            const empty = stock?.total_tablets === 0;
            const unavailable = loading || !!loadError;
            return <Card key={medicine.id} role="article" aria-label={`Medicamento: ${medicine.name}`} className="gap-0 rounded-2xl bg-white py-0">
              <CardContent className="flex h-full min-w-0 flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Pill className="size-5" /></span>
                  <div className="min-w-0">
                    <h3 className="break-words font-extrabold text-slate-900">{medicine.name}</h3>
                    <p className="mt-1 break-words text-sm text-slate-600">{medicine.dosage}</p>
                    {medicine.link && <a href={medicine.link} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm font-semibold text-blue-700 hover:underline">Ver referência</a>}
                  </div>
                </div>
                <div className="mt-4 flex flex-1 flex-col border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><Package className="size-4" /> Estoque</p>
                    {!unavailable && <span className={`rounded-full px-2 py-1 text-xs font-semibold ${empty ? "bg-red-50 text-red-700" : known ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                      {empty ? "Estoque esgotado" : known ? "Estoque informado" : "Estoque não informado"}
                    </span>}
                  </div>
                  {unavailable ? <p className="my-5 text-sm text-slate-500" role={loading ? "status" : undefined}>{loading ? "Carregando estoque…" : "Estoque indisponível"}</p> : <>
                    <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">{known ? formatStockQuantity(stock.total_tablets) : "—"}</p>
                    <p className="text-sm text-slate-500">{known ? "comprimidos disponíveis" : "Informe o saldo físico atual"}</p>
                    <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="text-slate-500">Por caixa</dt><dd className="mt-1 font-semibold">{formatStockQuantity(stock?.tablets_per_box)}</dd></div>
                      <div><dt className="text-slate-500">Por dia</dt><dd className="mt-1 font-semibold">{formatStockQuantity(stock?.tablets_per_day)}</dd></div>
                    </dl>
                    <StockForecast stock={stock} />
                  </>}
                  <Button type="button" variant="outline" disabled={unavailable || saving} onClick={() => openStock(medicine)} aria-label={`${canEdit ? "Configurar" : "Consultar"} estoque de ${medicine.name}`} className="mt-4 h-11 w-full rounded-xl border-blue-200 text-blue-700 hover:bg-blue-50">
                    {canEdit ? <Pencil /> : <Package />}{canEdit ? known ? "Atualizar estoque" : "Configurar estoque" : "Consultar estoque"}
                  </Button>
                </div>
              </CardContent>
            </Card>;
          })}
        </div>
      )}
      <Dialog open={!!selected} onOpenChange={open => { if (!open && !saveLock.current) setSelectedId(null); }}>
        <DialogContent showCloseButton={!saving} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl p-5 sm:max-w-lg sm:p-6">
          <DialogHeader className="pr-5 text-left">
            <DialogTitle className="text-xl">{canEdit ? "Configurar estoque" : "Consultar estoque"}</DialogTitle>
            <DialogDescription className="break-words">{selected?.name}</DialogDescription>
          </DialogHeader>
          {canEdit ? <form onSubmit={saveStock} className="grid min-w-0 gap-5">
            <p className="text-sm leading-6 text-slate-600">Informe quantos comprimidos você tem hoje. Deixe em branco o que ainda não souber. Use 0 somente quando o estoque estiver esgotado.</p>
            <fieldset disabled={saving} className="grid min-w-0 gap-4">
              {stockFields.map(({ key, label, min }) => <div key={key} className="grid min-w-0 gap-2">
                <Label htmlFor={`stock-${key}`}>{label}</Label>
                <Input id={`stock-${key}`} name={key} type="number" inputMode="numeric" min={min} max={2_147_483_647} step={1} value={draft[key]} placeholder="Não informado" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `stock-${key}-error` : key === "tablets_per_day" ? "stock-daily-help" : undefined}
                  onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setErrors(current => ({ ...current, [key]: undefined })); setSaveError(""); }} className="h-11 rounded-xl" />
                {key === "tablets_per_day" && <p id="stock-daily-help" className="text-xs leading-5 text-slate-500">Total de comprimidos utilizados ao longo de um dia, conforme sua orientação de uso.</p>}
                {errors[key] && <p id={`stock-${key}-error`} className="text-sm text-red-700">{errors[key]}</p>}
              </div>)}
            </fieldset>
            <div aria-live="polite"><StockForecast stock={preview ? { ...parsed.values, ...preview } : undefined} preview /></div>
            {saveError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
            {Object.keys(errors).some(key => !!errors[key as keyof StockErrors]) && <p role="alert" className="text-sm text-red-700">Confira os campos indicados antes de salvar.</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setSelectedId(null)} className="h-11 rounded-xl">Cancelar</Button>
              <Button disabled={saving || loading} className="h-11 rounded-xl bg-blue-600">{saving && <LoaderCircle className="animate-spin" />}{saving ? "Salvando…" : "Salvar estoque"}</Button>
            </div>
          </form> : <>
            <dl className="grid gap-4 rounded-2xl border border-slate-200 p-4 text-sm">
              {stockFields.map(({key,label}) => <div key={key}><dt className="text-slate-500">{label}</dt><dd className="mt-1 text-lg font-semibold">{formatStockQuantity(selected ? stocks[selected.id]?.[key] : null)}</dd></div>)}
            </dl>
            <StockForecast stock={selected ? stocks[selected.id] : undefined} />
            <p className="text-sm text-slate-500">Perfil visualizador: somente consulta.</p>
            <Button variant="outline" onClick={() => setSelectedId(null)} className="h-11 rounded-xl">Fechar</Button>
          </>}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StockForecast({stock, preview = false}: {stock?: {total_tablets: number | null; tablets_per_day: number | null; estimated_days: number | null; full_days_covered: number | null}; preview?: boolean}) {
  const days = stock?.estimated_days;
  return <div className="mt-auto rounded-xl bg-slate-50 p-3">
    <p className="text-xs font-semibold text-slate-500">{preview ? "Prévia da duração" : "Duração estimada"}</p>
    <p className="mt-1 text-lg font-bold text-blue-800">{formatStockDuration(days)}</p>
    <p className="mt-1 text-xs leading-5 text-slate-500">{days == null
      ? "Informe o total disponível e o consumo diário para calcular."
      : `${formatStockQuantity(stock?.total_tablets)} comprimidos ÷ ${formatStockQuantity(stock?.tablets_per_day)} por dia`}</p>
    {days != null && !Number.isInteger(days) && <p className="mt-1 text-xs font-medium text-slate-600">{stock?.full_days_covered} {stock?.full_days_covered === 1 ? "dia completo coberto" : "dias completos cobertos"}</p>}
  </div>;
}
