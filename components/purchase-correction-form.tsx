"use client";

import {type FormEvent, useEffect, useRef, useState} from "react";
import {LoaderCircle, Save} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {getBackend} from "@/lib/neon";
import {formatStockQuantity} from "@/lib/medication-stock";
import {localDay, normalizePurchase, parsePurchaseCorrection, parseQuantity, purchaseDraft, unitLabel,
  type MedicationPurchase, type PurchaseCorrectionDraft} from "@/lib/inventory";

export function PurchaseCorrectionForm({purchase,canEdit,onBusyChange,onCancel,onSaved}: {
  purchase: MedicationPurchase;
  canEdit: boolean;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: (purchase: MedicationPurchase, changed: boolean) => void;
}) {
  const [current, setCurrent] = useState(purchase);
  const [draft, setDraft] = useState<PurchaseCorrectionDraft>({...purchaseDraft(purchase),reason:""});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  const command = useRef<{payload:string;id:string}|null>(null);
  const today = localDay(new Date());
  useEffect(()=>{
    mounted.current = true;
    return ()=>{mounted.current=false;};
  },[]);
  function update(field: keyof PurchaseCorrectionDraft, value: string) {
    setDraft(current=>({...current,[field]:value}));
    if(!conflict)setError("");
  }
  let delta: number | null = null;
  try {const quantity=parseQuantity(draft.quantity,true);if(quantity!==null)delta=Math.round((quantity-current.quantity)*1000)/1000;}catch{}

  async function reload() {
    if (busy.current) return;
    busy.current=true;setLoading(true);onBusyChange(true);
    try {
      const {data,error}=await getBackend().from("medication_purchases").select("*").eq("id",current.id)
        .abortSignal(AbortSignal.timeout(20_000)).single();
      if (error || !data || data.revision == null) throw new Error("purchase-read");
      if (!mounted.current) return;
      const next=normalizePurchase(data as MedicationPurchase);
      setCurrent(next);setDraft({...purchaseDraft(next),reason:""});setConflict(false);setError("");command.current=null;
    }catch{if(mounted.current)setError("Não foi possível recarregar a compra. Tente novamente.");}
    finally{busy.current=false;onBusyChange(false);if(mounted.current)setLoading(false);}
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || busy.current || conflict || current.revision == null) return;
    setError("");
    let correction;
    try {correction=parsePurchaseCorrection(draft,today);}
    catch(error){setError(error instanceof Error ? error.message : "Confira os dados.");return;}
    const payload=JSON.stringify({id:current.id,revision:current.revision,...correction});
    if(command.current?.payload!==payload)command.current={payload,id:crypto.randomUUID()};
    busy.current=true;setSaving(true);onBusyChange(true);
    try {
      const {data,error}=await getBackend().rpc("correct_medication_purchase",{
        p_purchase_id:current.id,p_quantity:correction.quantity,p_purchased_on:correction.purchased_on,
        p_pharmacy:correction.pharmacy,p_reference_url:correction.reference_url,p_reason:correction.reason,
        p_expected_revision:current.revision,p_command:command.current.id,
        p_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      }).abortSignal(AbortSignal.timeout(20_000));
      if(error){
        if(error.code==="40001"&&mounted.current){
          setConflict(true);setError("Esta compra foi alterada em outro acesso. Recarregue os dados e revise a correção.");return;
        }
        throw error;
      }
      if(!data || data.id!==current.id || data.revision == null)throw new Error("purchase-result");
      if(!mounted.current)return;
      command.current=null;const saved=normalizePurchase(data as MedicationPurchase);onSaved(saved,saved.revision!==current.revision);
    }catch{if(mounted.current)setError("Não foi possível salvar a correção. Os valores foram mantidos; tente novamente sem duplicar o ajuste.");}
    finally{busy.current=false;onBusyChange(false);if(mounted.current)setSaving(false);}
  }
  return <form onSubmit={save} className="grid gap-4">
    <fieldset disabled={!canEdit||saving||loading||conflict} className="grid min-w-0 gap-4">
      <div className="grid gap-2"><Label htmlFor="correct-purchase-quantity">Quantidade comprada ({unitLabel(current.unit)})</Label>
        <Input id="correct-purchase-quantity" required inputMode="decimal" value={draft.quantity} onChange={e=>update("quantity",e.target.value)} />
      </div>
      <div className="grid gap-2"><Label htmlFor="correct-purchase-date">Data da compra</Label>
        <Input id="correct-purchase-date" type="date" required max={today} value={draft.purchased_on} onChange={e=>update("purchased_on",e.target.value)} />
      </div>
      <div className="grid gap-2"><Label htmlFor="correct-purchase-pharmacy">Farmácia</Label>
        <Input id="correct-purchase-pharmacy" required maxLength={160} value={draft.pharmacy} onChange={e=>update("pharmacy",e.target.value)} />
      </div>
      <div className="grid gap-2"><Label htmlFor="correct-purchase-link">Link da compra (opcional)</Label>
        <Input id="correct-purchase-link" type="url" maxLength={2048} value={draft.reference_url} onChange={e=>update("reference_url",e.target.value)} />
      </div>
      <div className="grid gap-2"><Label htmlFor="purchase-correction-reason">Motivo da correção</Label>
        <Textarea id="purchase-correction-reason" required value={draft.reason} onChange={e=>update("reason",e.target.value)} placeholder="Descreva o que foi corrigido." />
      </div>
    </fieldset>
    <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{delta===null ? "Informe a quantidade para calcular a diferença." : "Diferença no estoque: "+(delta>0?"+":"")+formatStockQuantity(delta)+" "+unitLabel(current.unit)+"."} As tomadas anteriores são preservadas, e a correção fica no histórico.</p>
    {error&&<div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>{error}</p>{conflict&&<Button type="button" variant="outline" disabled={loading} onClick={()=>void reload()} className="mt-2">Recarregar compra</Button>}</div>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" disabled={saving||loading} onClick={onCancel}>Cancelar</Button>
      <Button type="submit" disabled={!canEdit||saving||loading||conflict||current.revision==null}>{saving?<LoaderCircle className="animate-spin"/>:<Save/>}{saving?"Salvando…":"Salvar correção"}</Button>
    </div>
  </form>;
}
