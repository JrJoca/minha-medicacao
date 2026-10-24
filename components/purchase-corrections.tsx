"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {LoaderCircle} from "lucide-react";
import {Button} from "@/components/ui/button";
import {getBackend} from "@/lib/neon";
import {formatStockQuantity} from "@/lib/medication-stock";
import {unitLabel,type MedicationPurchase} from "@/lib/inventory";
type Correction={id:string;reason:string;quantity_delta:number;created_at:string;snapshot_before:MedicationPurchase;snapshot_after:MedicationPurchase};
const purchaseDate=(date:string)=>new Date(date+"T12:00:00").toLocaleDateString("pt-BR");

export function PurchaseCorrections({purchase,onBack}: {purchase:MedicationPurchase;onBack:()=>void}) {
  const [rows,setRows]=useState<Correction[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [hasMore,setHasMore]=useState(false);
  const mounted=useRef(false),busy=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const load=useCallback(async(offset:number)=>{
    if(busy.current)return;
    busy.current=true;setLoading(true);setError("");
    try{
      const {data,error}=await getBackend().from("medication_purchase_corrections")
        .select("id,reason,quantity_delta,created_at,snapshot_before,snapshot_after").eq("purchase_id",purchase.id)
        .order("created_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+19)
        .abortSignal(AbortSignal.timeout(20_000));
      if(error||!Array.isArray(data))throw new Error("correction-history");
      if(!mounted.current)return;
      setRows(previous=>offset?[...previous,...data as Correction[]]:data as Correction[]);setHasMore(data.length===20);
    }catch{if(mounted.current)setError("Não foi possível carregar as correções. Tente novamente.");}
    finally{busy.current=false;if(mounted.current)setLoading(false);}
  },[purchase.id]);
  useEffect(()=>{void Promise.resolve().then(()=>{if(mounted.current)void load(0);});},[load]);
  return <div className="grid gap-3">
    <Button type="button" variant="outline" onClick={onBack}>Voltar às compras</Button>
    {!loading&&!error&&!rows.length&&<p className="p-4 text-sm text-slate-500">Nenhuma correção registrada nesta compra.</p>}
    {rows.map(row=><article key={row.id} className="rounded-2xl border p-4 text-sm">
      <time dateTime={row.created_at} className="text-xs text-slate-500">{new Date(row.created_at).toLocaleString("pt-BR")}</time>
      <p className="mt-2 break-words font-semibold">{row.reason}</p>
      <dl className="mt-3 grid gap-2">
        <div><dt className="text-slate-500">Quantidade comprada</dt><dd>{formatStockQuantity(Number(row.snapshot_before.quantity))} → {formatStockQuantity(Number(row.snapshot_after.quantity))} {unitLabel(row.snapshot_after.unit)}</dd></div>
        <div><dt className="text-slate-500">Data da compra</dt><dd>{purchaseDate(row.snapshot_before.purchased_on)} → {purchaseDate(row.snapshot_after.purchased_on)}</dd></div>
        <div><dt className="text-slate-500">Farmácia</dt><dd className="break-words">{row.snapshot_before.pharmacy} → {row.snapshot_after.pharmacy}</dd></div>
        <div><dt className="text-slate-500">Link anterior</dt><dd className="break-all">{row.snapshot_before.reference_url||"Não informado"}</dd></div>
        <div><dt className="text-slate-500">Link corrigido</dt><dd className="break-all">{row.snapshot_after.reference_url||"Não informado"}</dd></div>
        <div><dt className="text-slate-500">Diferença aplicada ao estoque</dt><dd className="font-semibold">{Number(row.quantity_delta)>0?"+":""}{formatStockQuantity(Number(row.quantity_delta))} {unitLabel(row.snapshot_after.unit)}</dd></div>
      </dl>
    </article>)}
    {error&&<div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>{error}</p><Button type="button" variant="outline" disabled={loading} onClick={()=>void load(rows.length)} className="mt-2">Tentar novamente</Button></div>}
    {loading&&<p role="status" className="flex gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin"/>Carregando correções…</p>}
    {hasMore&&!error&&<Button type="button" variant="outline" disabled={loading} onClick={()=>void load(rows.length)}>Carregar mais correções</Button>}
  </div>;
}
