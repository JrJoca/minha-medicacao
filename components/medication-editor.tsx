"use client";

import {type FormEvent, useEffect, useRef, useState} from "react";
import {LoaderCircle, Save} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {getBackend, type ApplicationUser} from "@/lib/neon";
import type {Medication} from "@/lib/medication-catalog";
import {parseMedicationDetails, type MedicationDetailsDraft} from "@/lib/medication-details";

export function MedicationEditor({medicine, user, onClose, onSaved}: {
  medicine: Medication;
  user: ApplicationUser;
  onClose: () => void;
  onSaved: (updated: Medication) => void;
}) {
  const [draft, setDraft] = useState<MedicationDetailsDraft>({name:medicine.name, dosage:medicine.dosage, link:medicine.link || ""});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const mounted = useRef(false);
  const canEdit = user.role === "owner";
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function update(field: keyof MedicationDetailsDraft, value: string) {
    setDraft(current=>({...current,[field]:value}));
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || busy.current) return;
    setError("");
    let changes;
    try { changes = parseMedicationDetails(draft); }
    catch (error) { setError(error instanceof Error ? error.message : "Confira as informações.");return; }
    busy.current = true;setSaving(true);
    try {
      const {data,error} = await getBackend().from("medications")
        .update(changes).eq("id",medicine.id).eq("user_id",user.id)
        .select("id,name,dosage,reference_url,is_active")
        .abortSignal(AbortSignal.timeout(20_000)).single();
      if (error || !data || data.id !== medicine.id || typeof data.name !== "string" ||
        typeof data.dosage !== "string" || typeof data.is_active !== "boolean" ||
        (data.reference_url !== null && typeof data.reference_url !== "string")) throw new Error("medication-update");
      if (!mounted.current) return;
      onSaved({id:data.id,name:data.name,dosage:data.dosage,link:data.reference_url || "",active:data.is_active});
    } catch {
      if (mounted.current) setError("Não foi possível salvar o cadastro. Suas alterações foram mantidas para tentar novamente.");
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return <Dialog open onOpenChange={open=>{if(!open && !busy.current)onClose();}}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl sm:max-w-lg" showCloseButton={!saving}>
      <DialogHeader>
        <DialogTitle>Editar medicamento</DialogTitle>
        <DialogDescription>Atualize o nome, a dosagem e o link. As rotinas vinculadas passarão a exibir o cadastro atualizado.</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="grid gap-4">
        <fieldset disabled={saving || !canEdit} className="grid min-w-0 gap-4">
          <div className="grid gap-2"><Label htmlFor="edit-medication-name">Nome do medicamento</Label>
            <Input id="edit-medication-name" required value={draft.name} onChange={e=>update("name",e.target.value)} />
          </div>
          <div className="grid gap-2"><Label htmlFor="edit-medication-dosage">Dosagem</Label>
            <Input id="edit-medication-dosage" required value={draft.dosage} onChange={e=>update("dosage",e.target.value)} />
            <p className="text-xs leading-5 text-slate-500">A quantidade de comprimidos ou ml por tomada é definida nas rotinas.</p>
          </div>
          <div className="grid gap-2"><Label htmlFor="edit-medication-link">Link de referência (opcional)</Label>
            <Input id="edit-medication-link" type="url" value={draft.link} onChange={e=>update("link",e.target.value)} placeholder="https://" />
          </div>
        </fieldset>
        <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">O saldo, as compras e as quantidades das rotinas são preservados.</p>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose} className="h-11 rounded-xl">Cancelar</Button>
          <Button type="submit" disabled={saving || !canEdit} className="h-11 rounded-xl">{saving ? <LoaderCircle className="animate-spin" /> : <Save />}{saving ? "Salvando…" : "Salvar alterações"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
