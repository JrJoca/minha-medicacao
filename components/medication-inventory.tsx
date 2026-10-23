"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Check, History, LoaderCircle, Package, Pencil, Pill, Power, RefreshCw, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBackend, type ApplicationUser } from "@/lib/neon";
import { formatStockDuration, formatStockQuantity } from "@/lib/medication-stock";
import { normalizeInventory, parseQuantity, unitLabel, type Inventory, type QuantityUnit } from "@/lib/inventory";
import type { Medication as Medicine } from "@/lib/medication-catalog";
import { forecastStock, formatForecastDate, type ForecastRoutine } from "@/lib/stock-forecast";
import { MedicationPurchases } from "@/components/medication-purchases";
const stockFields = [
  {key:"quantity",label:"Quantidade disponível",min:0},
  {key:"quantity_per_package",label:"Quantidade por caixa ou frasco",min:0.001},
] as const;
type StockDraft = {quantity:string;quantity_per_package:string;unit:QuantityUnit};
type StockErrors = Partial<Record<keyof StockDraft,string>>;
const stockDraft = (s?:Inventory):StockDraft => ({quantity:String(s?.quantity ?? ""),quantity_per_package:String(s?.quantity_per_package ?? ""),unit:s?.unit ?? "tablet"});
function parseStockDraft(draft:StockDraft) {
  const errors:StockErrors={}; const values:{quantity:number|null;quantity_per_package:number|null}={quantity:null,quantity_per_package:null};
  for (const {key,min} of stockFields) {try {values[key]=parseQuantity(draft[key],min>0);}catch {errors[key]="Informe uma quantidade válida com até 3 casas decimais.";}}
  return {values,errors,valid:Object.keys(errors).length===0};
}

export function MedicationInventory({ medicines, user, dataLoading, revision, catalogError, catalogRecovered, onReloadCatalog, routines, forecastReady, now }: {
  medicines: Medicine[];
  user: ApplicationUser;
  dataLoading: boolean;
  revision: number;
  catalogError?: string;
  catalogRecovered?: boolean;
  onReloadCatalog?: () => Promise<void>;
  routines: ForecastRoutine[];
  forecastReady: boolean;
  now: Date;
}) {
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [statusBusy, setStatusBusy] = useState(false);
  const statusLock = useRef(false);
  const [purchaseTarget, setPurchaseTarget] = useState<{id:string;mode:"purchase"|"history"}|null>(null);
  const [stocks, setStocks] = useState<Record<string, Inventory>>({});
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
  const saveCommand=useRef<{payload:string;id:string}|null>(null);
  const medicineIds = medicines.map(medicine => medicine.id).join(":");
  const canEdit = user.role === "owner";
  const selected = medicines.find(medicine => medicine.id === selectedId);


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
        const { data, error } = await getBackend().rpc("inventory_summary").abortSignal(controller.signal);
        if (error) throw error;
        if (controller.signal.aborted || revision !== requestRevision.current) return;
        const next: Record<string, Inventory> = {};
        for (const row of data ?? []) next[row.medication_id] = normalizeInventory(row);
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
  }, [medicineIds, user.authId, refresh, revision]);

  function openStock(medicine: Medicine) {
    if (loading || loadError) return;
    setDraft({...stockDraft(stocks[medicine.id]),quantity:stocks[medicine.id]?.quantity != null && stocks[medicine.id].quantity! < 0 ? "" : String(stocks[medicine.id]?.quantity ?? "")});
    setErrors({});
    setSaveError("");
    setMessage("");
    setSelectedId(medicine.id);
  }

  async function changeStatus(medicine: Medicine) {
    if (!canEdit || statusLock.current || dataLoading || catalogError) return;
    statusLock.current = true;setStatusBusy(true);setMessage("");setSaveError("");
    try {
      const {error} = await getBackend().rpc("set_medication_active", {p_medication_id:medicine.id,p_active:!medicine.active}).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw error;
      if (!mounted.current) return;
      await onReloadCatalog?.();
      if (mounted.current) setMessage(medicine.name + (medicine.active ? " desativado. Os vínculos das rotinas existentes foram preservados." : " ativado e disponível para novas rotinas."));
    } catch {
      if (mounted.current) setSaveError("Não foi possível alterar a situação do medicamento. Atualize a lista e tente novamente.");
    } finally {statusLock.current = false;if(mounted.current)setStatusBusy(false);}
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
    const payload=JSON.stringify({id:medicine.id,...result.values,unit:draft.unit});
    if(saveCommand.current?.payload!==payload) saveCommand.current={payload,id:crypto.randomUUID()};
    try {
      const { error } = await getBackend().rpc("set_medication_inventory", {
        p_medication_id:medicine.id,p_quantity:result.values.quantity,p_package:result.values.quantity_per_package,p_unit:draft.unit,p_command:saveCommand.current.id,
      });
      if (error) throw error;
      if (!mounted.current) return;
      saveCommand.current=null;
      setRefresh(value => value + 1);
      setSelectedId(null);
      setMessage(`Estoque de ${medicine.name} atualizado.`);
    } catch {
      if (mounted.current) setSaveError("Não foi possível salvar o estoque. Os valores foram mantidos para você tentar novamente.");
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const informed = medicines.filter(medicine => stocks[medicine.id]?.quantity != null).length;
  return (
    <section className="mb-8" aria-labelledby="medication-list-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="medication-list-title" className="text-xl font-bold">Medicamentos cadastrados</h2>
          <p className="mt-1 text-sm text-slate-500">Consulte seus medicamentos e acompanhe o estoque disponível.</p>
        </div>
        <Button type="button" variant="outline" disabled={loading || saving || dataLoading} onClick={() => { setRefresh(value => value + 1); onReloadCatalog?.(); }} className="h-10 rounded-xl bg-white">
          <RefreshCw className={loading ? "animate-spin" : ""} /> Atualizar saldos
        </Button>
      </div>
      <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-blue-900">
        <p className="font-semibold">Estoque atualizado pelas tomadas.</p>
        <p>As rotinas ativas determinam o consumo. Cada tomada confirmada atualiza o saldo; desfazer estorna a baixa. Registre compras para somar unidades ou confira o saldo físico para corrigir a contagem.</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Filtrar medicamentos">
        {([ ["all","Todos"], ["active","Ativos"], ["inactive","Desativados"] ] as const).map(([value,label])=><Button key={value} type="button" variant={filter===value ? "default" : "outline"} aria-pressed={filter===value} onClick={()=>setFilter(value)} className="rounded-xl">{label} ({medicines.filter(m=>value==="all" || (value==="active" ? m.active : !m.active)).length})</Button>)}
      </div>
      {saveError && !selected && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
      {catalogError && <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p>{catalogError}</p><Button variant="outline" disabled={dataLoading} onClick={onReloadCatalog} className="mt-3 rounded-xl">Tentar novamente</Button></div>}
      {catalogRecovered && <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">Mostrando os medicamentos usados nas rotinas. Atualize a lista para consultar o cadastro completo.</p>}
      {loadError && <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p>{loadError}</p>
        <Button type="button" variant="outline" className="mt-3 rounded-xl bg-white" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</Button>
      </div>}
      {message && <p role="status" className="mb-4 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><Check className="mt-0.5 size-4 shrink-0" />{message}</p>}
      {!loading && !loadError && medicines.length > 0 && <p className="mb-3 text-sm text-slate-500">{informed} de {medicines.length} com saldo informado</p>}
      {medicines.length === 0 ? (
        <Card className="rounded-3xl border-dashed border-slate-300 bg-white">
          <CardContent className="text-sm text-slate-500">{dataLoading ? "Carregando medicamentos…" : catalogError ? "O cadastro está indisponível. Seus medicamentos não foram excluídos." : "Nenhum medicamento cadastrado."}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {medicines.filter(m=>filter==="all" || (filter==="active" ? m.active : !m.active)).map(medicine => {
            const stock = stocks[medicine.id];
            const known = stock?.quantity != null;
            const empty = stock?.quantity != null && stock.quantity <= 0;
            const negative = stock?.quantity != null && stock.quantity < 0;
            const unavailable = loading || !!loadError;
            return <Card key={medicine.id} role="article" aria-label={`Medicamento: ${medicine.name}`} className="gap-0 rounded-2xl bg-white py-0">
              <CardContent className="flex h-full min-w-0 flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Pill className="size-5" /></span>
                  <div className="min-w-0">
                    <h3 className="break-words font-extrabold text-slate-900">{medicine.name}</h3>
                    <p className="mt-1 break-words text-sm text-slate-600">{medicine.dosage}</p>
                    <span className={"mt-2 inline-block rounded-full px-2 py-1 text-xs font-semibold " + (medicine.active ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600")}>{medicine.active ? "Ativo" : "Desativado"}</span>
                    {medicine.link && <a href={medicine.link} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm font-semibold text-blue-700 hover:underline">Ver referência</a>}
                  </div>
                </div>
                <div className="mt-4 flex flex-1 flex-col border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><Package className="size-4" /> Estoque</p>
                    {!unavailable && <span className={`rounded-full px-2 py-1 text-xs font-semibold ${empty ? "bg-red-50 text-red-700" : known ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                      {negative ? "Saldo divergente: confira" : empty ? "Estoque esgotado" : known ? "Estoque informado" : "Estoque não informado"}
                    </span>}
                  </div>
                  {unavailable ? <p className="my-5 text-sm text-slate-500" role={loading ? "status" : undefined}>{loading ? "Carregando estoque…" : "Estoque indisponível"}</p> : <>
                    <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">{known ? formatStockQuantity(stock.quantity) : "—"}</p>
                    <p className="text-sm text-slate-500">{known ? `${unitLabel(stock?.unit)} disponíveis` : "Informe o saldo físico atual"}</p>
                    <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="text-slate-500">Por caixa / frasco</dt><dd className="mt-1 font-semibold">{formatStockQuantity(stock?.quantity_per_package)}</dd></div>
                      <div><dt className="text-slate-500">Por dia</dt><dd className="mt-1 font-semibold">{formatStockQuantity(stock?.daily_quantity)}</dd></div>
                    </dl>
                    {negative && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">Faltam {formatStockQuantity(Math.abs(stock.quantity!))} {unitLabel(stock.unit)} no saldo registrado. A tomada foi preservada; confira o estoque físico.</p>}
                    <StockForecast medicationId={medicine.id} stock={stock} routines={routines} ready={forecastReady} now={now} />
                  </>}
                  <Button type="button" variant="outline" disabled={unavailable || saving} onClick={() => openStock(medicine)} aria-label={`${canEdit ? "Configurar" : "Consultar"} estoque de ${medicine.name}`} className="mt-4 h-11 w-full rounded-xl border-blue-200 text-blue-700 hover:bg-blue-50">
                    {canEdit ? <Pencil /> : <Package />}{canEdit ? known ? "Conferir saldo físico" : "Configurar estoque" : "Consultar estoque"}
                  </Button>
                  <div className="mt-2 grid gap-2">
                    <Button type="button" variant="outline" disabled={!canEdit || unavailable || saving || dataLoading || !!catalogError} onClick={()=>setPurchaseTarget({id:medicine.id,mode:"purchase"})} className="h-11 rounded-xl"><ShoppingBag />Registrar compra</Button>
                    <Button type="button" variant="ghost" disabled={dataLoading || !!catalogError} onClick={()=>setPurchaseTarget({id:medicine.id,mode:"history"})} className="h-10 rounded-xl"><History />Ver compras</Button>
                    <Button type="button" variant="ghost" disabled={!canEdit || statusBusy || dataLoading || !!catalogError} onClick={()=>void changeStatus(medicine)} aria-label={(medicine.active ? "Desativar " : "Ativar ")+medicine.name} className="h-10 rounded-xl"><Power />{medicine.active ? "Desativar medicamento" : "Ativar medicamento"}</Button>
                  </div>
                </div>
              </CardContent>
            </Card>;
          })}
        </div>
      )}
      {!!medicines.length && !medicines.some(m=>filter==="all" || (filter==="active" ? m.active : !m.active)) && <p className="rounded-2xl border border-dashed p-5 text-sm text-slate-500">Nenhum medicamento neste filtro.</p>}
      {purchaseTarget && medicines.find(m=>m.id===purchaseTarget.id) && <MedicationPurchases key={purchaseTarget.id+purchaseTarget.mode}
        medicine={medicines.find(m=>m.id===purchaseTarget.id)!} stock={stocks[purchaseTarget.id]} mode={purchaseTarget.mode} canEdit={canEdit}
        onClose={()=>setPurchaseTarget(null)} onSaved={()=>{setPurchaseTarget(null);setRefresh(value=>value+1);setMessage("Compra registrada e somada ao estoque.");}}
        onConfigureStock={()=>{const medicine=medicines.find(m=>m.id===purchaseTarget.id);setPurchaseTarget(null);if(medicine)openStock(medicine);}} />}
      <Dialog open={!!selected} onOpenChange={open => { if (!open && !saveLock.current) setSelectedId(null); }}>
        <DialogContent showCloseButton={!saving} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl p-5 sm:max-w-lg sm:p-6">
          <DialogHeader className="pr-5 text-left">
            <DialogTitle className="text-xl">{canEdit ? "Configurar estoque" : "Consultar estoque"}</DialogTitle>
            <DialogDescription className="break-words">{selected?.name}</DialogDescription>
          </DialogHeader>
          {canEdit ? <form onSubmit={saveStock} className="grid min-w-0 grid-cols-1 gap-5">
            <p className="text-sm leading-6 text-slate-600">Informe o saldo físico atual, incluindo reposições. Use 0 para estoque esgotado. O consumo por dia é calculado pelas rotinas diárias ativas; para vários horários, cadastre uma rotina para cada horário.</p>
            <fieldset disabled={saving} className="grid min-w-0 gap-4">
              <div className="grid gap-2"><Label htmlFor="stock-unit">Unidade do estoque</Label>
                <select id="stock-unit" className="h-11 w-full min-w-0 rounded-xl border bg-white px-3" value={draft.unit} disabled={!!(selected && stocks[selected.id]?.unit)} onChange={e=>setDraft(current=>({...current,unit:e.target.value as QuantityUnit}))}>
                  <option value="tablet">Comprimidos</option><option value="ml">ml</option>
                </select>
                <p className="text-xs text-slate-500">Use a mesma unidade nas rotinas. Não há conversão entre comprimidos e ml.</p>
              </div>
              {stockFields.map(({ key, label, min }) => <div key={key} className="grid min-w-0 gap-2">
                <Label htmlFor={`stock-${key}`}>{label}</Label>
                <Input id={`stock-${key}`} name={key} type="number" inputMode="decimal" min={min} max={999999999.999} step={0.001} required={key==="quantity" && selectedId!==null && stocks[selectedId]?.quantity!=null} value={draft[key]} placeholder="Não informado" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `stock-${key}-error` : undefined}
                  onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setErrors(current => ({ ...current, [key]: undefined })); setSaveError(""); }} className="h-11 rounded-xl" />

                {errors[key] && <p id={`stock-${key}-error`} className="text-sm text-red-700">{errors[key]}</p>}
              </div>)}
            </fieldset>
            <StockForecast medicationId={selected?.id || ""} stock={selected ? stocks[selected.id] : undefined} routines={routines} ready={forecastReady} now={now} />
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
            <StockForecast medicationId={selected?.id || ""} stock={selected ? stocks[selected.id] : undefined} routines={routines} ready={forecastReady} now={now} />
            <p className="text-sm text-slate-500">Perfil visualizador: somente consulta.</p>
            <Button variant="outline" onClick={() => setSelectedId(null)} className="h-11 rounded-xl">Fechar</Button>
          </>}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StockForecast({medicationId,stock,routines,ready,now}: {medicationId:string;stock?:Inventory;routines:ForecastRoutine[];ready:boolean;now:Date}) {
  const forecast = forecastStock(medicationId,stock?.quantity ?? null,stock?.unit ?? null,routines,now);
  const reason = forecast.state === "missing_balance" ? "Informe o saldo físico para calcular."
    : forecast.state === "no_routines" ? "Nenhuma rotina ativa utiliza este medicamento."
    : forecast.state === "missing_doses" ? "Configure quantidades e frequência diária em todas as rotinas ativas deste medicamento."
    : forecast.state === "out_of_range" ? "A quantidade excede o período de calendário que pode ser exibido."
    : forecast.state === "covered" ? "O saldo cobre o período configurado das rotinas ativas." : "";
  return <div className="mt-auto rounded-xl bg-slate-50 p-3">
    <p className="text-xs font-semibold text-slate-500">Previsão de término do estoque</p>
    {!ready ? <p className="mt-2 text-sm text-slate-500">Atualizando as rotinas para calcular a previsão…</p> : <>
      <p className="mt-1 text-lg font-bold text-blue-800">{forecast.state === "forecast" ? forecast.lastCovered ? formatForecastDate(forecast.lastCovered) : "Sem uma dose completa disponível" : forecast.state === "covered" ? "Cobre o tratamento" : "Sem previsão"}</p>
      {forecast.lastCovered && forecast.state === "forecast" && <p className="mt-1 text-xs text-slate-500">Última tomada totalmente coberta</p>}
      {forecast.firstUncovered && <p className="mt-2 text-sm font-semibold text-amber-800">Repor até {formatForecastDate(forecast.firstUncovered)}</p>}
      {reason && <p className="mt-1 text-xs leading-5 text-slate-500">{reason}</p>}
      {forecast.state === "forecast" && <p className="mt-2 text-xs leading-5 text-slate-500">{formatStockQuantity(forecast.dailyQuantity)} {unitLabel(stock?.unit)} por dia · {formatStockDuration(stock?.estimated_days)} de consumo. Considera as doses ainda pendentes de hoje e os dias restantes do tratamento. A previsão muda com as rotinas e o saldo.</p>}
    </>}
  </div>;
}
