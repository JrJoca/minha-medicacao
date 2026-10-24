"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { History, LoaderCircle, Pencil, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBackend } from "@/lib/neon";
import type { Medication } from "@/lib/medication-catalog";
import { localDay, normalizePurchase, parsePurchase, unitLabel, type Inventory, type MedicationPurchase, type PurchaseDraft } from "@/lib/inventory";
import { formatStockQuantity } from "@/lib/medication-stock";
import { PurchaseCorrectionForm } from "@/components/purchase-correction-form";
import { PurchaseCorrections } from "@/components/purchase-corrections";

export function MedicationPurchases({medicine, stock, mode, canEdit, onClose, onSaved, onCorrected, onConfigureStock}: {
  medicine: Medication;
  stock?: Inventory;
  mode: "purchase" | "history";
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCorrected: () => void;
  onConfigureStock: () => void;
}) {
  const [draft, setDraft] = useState<PurchaseDraft>({quantity:"", purchased_on:localDay(new Date()), pharmacy:"", reference_url:""});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<MedicationPurchase[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState<MedicationPurchase | null>(null);
  const [corrections, setCorrections] = useState<MedicationPurchase | null>(null);
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const busy = useRef(false);
  const command = useRef<{payload:string;id:string} | null>(null);
  const reading = useRef(false);
  const generation = useRef(0);
  const today = localDay(new Date());
  const knownBalance = stock?.quantity != null && !!stock.unit;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const loadHistory = useCallback(async (offset: number) => {
    if (reading.current) return;
    reading.current = true;
    const current = ++generation.current;
    setLoading(true);setError("");
    try {
      const {data,error} = await getBackend().from("medication_purchases")
        .select("*")
        .eq("medication_id",medicine.id).order("purchased_on",{ascending:false})
        .order("created_at",{ascending:false}).order("id",{ascending:false})
        .range(offset,offset+19).abortSignal(AbortSignal.timeout(20_000));
      if (error || !Array.isArray(data)) throw new Error("purchase-history");
      if (!mounted.current || current !== generation.current) return;
      const rows = data.map(row=>normalizePurchase(row as MedicationPurchase));
      setHistory(previous=>offset ? [...previous,...rows] : rows);
      setHasMore(rows.length === 20);
    } catch {
      if (mounted.current && current === generation.current) setError("Não foi possível carregar as compras. Tente novamente.");
    } finally {
      reading.current = false;
      if (mounted.current && current === generation.current) setLoading(false);
    }
  }, [medicine.id]);
  useEffect(() => {
    if (mode === "history") void Promise.resolve().then(()=>{ if (mounted.current) void loadHistory(0); });
  }, [mode,loadHistory]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || busy.current || !knownBalance || !stock?.unit) return;
    setError("");
    let purchase;
    try { purchase = parsePurchase(draft,today); }
    catch (error) { setError(error instanceof Error ? error.message : "Confira as informações da compra."); return; }
    busy.current = true;setSaving(true);
    const payload = JSON.stringify({medication:medicine.id,unit:stock.unit,...purchase});
    if (command.current?.payload !== payload) command.current = {payload,id:crypto.randomUUID()};
    try {
      const {error} = await getBackend().rpc("record_medication_purchase",{
        p_medication_id:medicine.id,p_quantity:purchase.quantity,p_unit:stock.unit,
        p_purchased_on:purchase.purchased_on,p_pharmacy:purchase.pharmacy,p_reference_url:purchase.reference_url,
        p_command:command.current.id,p_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw error;
      if (!mounted.current) return;
      command.current = null;
      onSaved();
    } catch {
      if (mounted.current) setError("Não foi possível registrar a compra. Os valores foram mantidos; tente novamente para conferir a operação sem duplicar a entrada.");
    } finally { busy.current = false;if (mounted.current) setSaving(false); }
  }
  return <Dialog open onOpenChange={open=>{if(!open && !busy.current)onClose();}}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" showCloseButton={!saving}>
      <DialogHeader>
        <DialogTitle>{mode === "purchase" ? "Registrar compra" : editing ? "Corrigir compra" : corrections ? "Histórico de correções" : "Compras registradas"} — {medicine.name}</DialogTitle>
        <DialogDescription>{mode === "purchase" ? "A quantidade comprada será somada ao saldo atual. A previsão será recalculada pelas rotinas ativas." : editing ? "Corrija os dados da compra e informe o motivo. A diferença da quantidade será aplicada ao estoque." : "Consulte as compras e o registro das correções, com os valores anteriores preservados."}</DialogDescription>
      </DialogHeader>
      {mode === "purchase" ? !knownBalance ? <div className="grid gap-4">
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Confira o saldo físico antes da primeira compra. Se não há unidades disponíveis, informe zero.</p>
        <Button onClick={onConfigureStock} disabled={!canEdit}>Conferir saldo físico</Button>
      </div> : <form onSubmit={save} className="grid gap-4">
        <fieldset disabled={saving || !canEdit} className="grid min-w-0 gap-4">
          <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">Saldo atual: <strong>{formatStockQuantity(stock?.quantity)} {unitLabel(stock?.unit)}</strong></p>
          <div className="grid gap-2"><Label htmlFor="purchase-quantity">Quantidade comprada ({unitLabel(stock?.unit)})</Label>
            <Input id="purchase-quantity" type="text" inputMode="decimal" required maxLength={20} value={draft.quantity} onChange={e=>setDraft({...draft,quantity:e.target.value})} placeholder="Ex.: 30 ou 2,5" />
          </div>
          <div className="grid gap-2"><Label htmlFor="purchase-date">Data da compra</Label>
            <Input id="purchase-date" type="date" required max={today} value={draft.purchased_on} onChange={e=>setDraft({...draft,purchased_on:e.target.value})} />
          </div>
          <div className="grid gap-2"><Label htmlFor="purchase-pharmacy">Farmácia</Label>
            <Input id="purchase-pharmacy" required maxLength={160} value={draft.pharmacy} onChange={e=>setDraft({...draft,pharmacy:e.target.value})} placeholder="Onde você comprou" />
          </div>
          <div className="grid gap-2"><Label htmlFor="purchase-link">Link da compra (opcional)</Label>
            <Input id="purchase-link" type="url" maxLength={2048} value={draft.reference_url} onChange={e=>setDraft({...draft,reference_url:e.target.value})} placeholder="https://" />
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <Button type="submit" className="h-11 rounded-xl">{saving ? <LoaderCircle className="animate-spin" /> : <ShoppingBag />}{saving ? "Registrando…" : "Registrar e somar ao estoque"}</Button>
        </fieldset>
      </form> : editing ? <PurchaseCorrectionForm key={editing.id} purchase={editing} canEdit={canEdit}
        onBusyChange={value=>{busy.current=value;if(mounted.current)setSaving(value);}} onCancel={()=>setEditing(null)}
        onSaved={(updated,changed)=>{setHistory(previous=>previous.map(row=>row.id===updated.id?updated:row));setEditing(null);setNotice(changed?"Compra corrigida. Os dados anteriores foram preservados no histórico.":"Os dados da compra já estavam atualizados.");if(changed)onCorrected();void loadHistory(0);}} />
        : corrections ? <PurchaseCorrections key={corrections.id} purchase={corrections} onBack={()=>setCorrections(null)} />
        : <div className="grid gap-3">
        <Button type="button" variant="outline" disabled={loading} onClick={()=>void loadHistory(0)}>Atualizar compras</Button>
        {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {error && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>{error}</p><Button variant="outline" className="mt-2" disabled={loading} onClick={()=>void loadHistory(history.length)}>Tentar novamente</Button></div>}
        {!history.length && !loading && !error && <p className="p-4 text-sm text-slate-500">Nenhuma compra registrada para este medicamento.</p>}
        {history.map(purchase=><article key={purchase.id} className="rounded-2xl border p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <strong>{formatStockQuantity(purchase.quantity)} {unitLabel(purchase.unit)}</strong>
            <time dateTime={purchase.purchased_on}>{new Date(purchase.purchased_on+"T12:00:00").toLocaleDateString("pt-BR")}</time>
          </div>
          <p className="mt-2 break-words">{purchase.pharmacy}</p>
          {purchase.reference_url && <a className="mt-2 block break-all font-medium text-blue-700 underline" href={purchase.reference_url} target="_blank" rel="noreferrer">Abrir link da compra</a>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!canEdit||loading||purchase.revision==null} onClick={()=>{setNotice("");setEditing(purchase);}}><Pencil/>Editar compra</Button>
            <Button type="button" variant="ghost" disabled={loading} onClick={()=>setCorrections(purchase)}><History/>Ver correções</Button>
          </div>
        </article>)}
        {loading && <p role="status" className="flex gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando compras…</p>}
        {hasMore && !error && <Button variant="outline" disabled={loading} onClick={()=>void loadHistory(history.length)}>Carregar mais compras</Button>}
      </div>}
    </DialogContent>
  </Dialog>;
}
