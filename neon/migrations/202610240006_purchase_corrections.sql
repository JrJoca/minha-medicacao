-- Correções preservam a compra original nos snapshots e ajustam somente a diferença.
ALTER TABLE public.medication_purchases
  ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0);

CREATE TABLE public.medication_purchase_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  medication_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  quantity_delta numeric NOT NULL,
  snapshot_before jsonb NOT NULL CHECK (jsonb_typeof(snapshot_before)='object'),
  snapshot_after jsonb NOT NULL CHECK (jsonb_typeof(snapshot_after)='object'),
  stock_movement_id uuid UNIQUE REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(purchase_id,user_id) REFERENCES public.medication_purchases(id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(medication_id,user_id) REFERENCES public.medications(id,user_id) ON DELETE RESTRICT,
  CHECK ((quantity_delta=0)=(stock_movement_id IS NULL))
);
CREATE INDEX purchase_corrections_owner_date ON public.medication_purchase_corrections(user_id,purchase_id,created_at DESC,id DESC);
ALTER TABLE public.medication_purchase_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medication_purchase_corrections FROM PUBLIC,anonymous,authenticated;
GRANT SELECT ON public.medication_purchase_corrections TO authenticated;
CREATE POLICY purchase_correction_read ON public.medication_purchase_corrections FOR SELECT TO authenticated
  USING ((SELECT application_private.can_read(user_id)));

CREATE FUNCTION public.correct_medication_purchase(
  p_purchase_id uuid,p_quantity numeric,p_purchased_on date,p_pharmacy text,
  p_reference_url text,p_reason text,p_expected_revision bigint,p_command uuid,
  p_timezone text DEFAULT 'America/Sao_Paulo'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,application_private AS $$
DECLARE actor uuid:=application_private.stock_owner(); purchase public.medication_purchases;
  s public.medication_stock; payload jsonb; cached application_private.stock_commands;
  previous jsonb; result jsonb; delta numeric; amount numeric; movement uuid;
BEGIN
  IF p_command IS NULL THEN RAISE EXCEPTION 'Operação inválida.'; END IF;
  payload:=jsonb_build_object('action','correct_purchase','purchase',p_purchase_id,
    'quantity',p_quantity,'purchased_on',p_purchased_on,'pharmacy',p_pharmacy,
    'reference_url',p_reference_url,'reason',p_reason,'expected_revision',p_expected_revision,'timezone',p_timezone);
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_command::text,0));
  SELECT * INTO cached FROM application_private.stock_commands WHERE user_id=actor AND command_id=p_command;
  IF FOUND THEN
    IF cached.payload<>payload THEN RAISE EXCEPTION 'Identificador já utilizado em outra operação.'; END IF;
    RETURN cached.result;
  END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity>999999999.999 OR p_quantity<>round(p_quantity,3) THEN
    RAISE EXCEPTION 'Informe a quantidade comprada, com até três casas decimais.'; END IF;
  IF p_timezone IS NULL OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Fuso horário inválido.'; END IF;
  IF p_purchased_on IS NULL OR NOT isfinite(p_purchased_on) OR p_purchased_on>(now() AT TIME ZONE p_timezone)::date THEN
    RAISE EXCEPTION 'Informe uma data de compra válida, até hoje.'; END IF;
  IF p_pharmacy IS NULL OR length(btrim(p_pharmacy)) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Informe a farmácia.'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Informe o motivo da correção.'; END IF;
  SELECT * INTO purchase FROM public.medication_purchases WHERE id=p_purchase_id AND user_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra indisponível.' USING ERRCODE='42501'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<>purchase.revision THEN
    RAISE EXCEPTION 'Esta compra foi alterada em outro acesso. Recarregue os dados e revise a correção.' USING ERRCODE='40001';
  END IF;
  previous:=to_jsonb(purchase);
  IF ROW(purchase.quantity,purchase.purchased_on,purchase.pharmacy,purchase.reference_url)
    IS NOT DISTINCT FROM ROW(p_quantity,p_purchased_on,btrim(p_pharmacy),nullif(btrim(p_reference_url),'')) THEN
    INSERT INTO application_private.stock_commands VALUES(actor,p_command,payload,previous);
    RETURN previous;
  END IF;
  PERFORM 1 FROM public.medications WHERE id=purchase.medication_id AND user_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento indisponível.' USING ERRCODE='42501'; END IF;
  delta:=p_quantity-purchase.quantity;
  IF delta<>0 THEN
    SELECT * INTO s FROM public.medication_stock WHERE medication_id=purchase.medication_id FOR UPDATE;
    IF s.quantity IS NULL OR s.unit IS DISTINCT FROM purchase.unit THEN
      RAISE EXCEPTION 'Confira o saldo físico e a unidade antes de corrigir a quantidade da compra.'; END IF;
    amount:=s.quantity+delta;
    IF abs(amount)>999999999.999 THEN RAISE EXCEPTION 'O saldo excede o limite permitido.'; END IF;
    INSERT INTO public.stock_movements(user_id,medication_id,kind,quantity_delta,unit,applied_to_balance,snapshot)
      VALUES(actor,purchase.medication_id,'adjustment',delta,purchase.unit,true,
        jsonb_build_object('source','purchase_correction','purchase_id',purchase.id,'previous_quantity',purchase.quantity,
          'corrected_quantity',p_quantity,'reason',btrim(p_reason)))
      RETURNING id INTO movement;
    UPDATE public.medication_stock SET quantity=amount,
      total_tablets=CASE WHEN s.unit='tablet' AND amount>=0 AND amount=trunc(amount) THEN amount::integer END
      WHERE medication_id=purchase.medication_id;
  END IF;
  UPDATE public.medication_purchases SET quantity=p_quantity,purchased_on=p_purchased_on,
    pharmacy=btrim(p_pharmacy),reference_url=nullif(btrim(p_reference_url),''),revision=revision+1
    WHERE id=purchase.id RETURNING * INTO purchase;
  result:=to_jsonb(purchase);
  INSERT INTO public.medication_purchase_corrections(user_id,purchase_id,medication_id,reason,quantity_delta,snapshot_before,snapshot_after,stock_movement_id)
    VALUES(actor,purchase.id,purchase.medication_id,btrim(p_reason),delta,previous,result,movement);
  INSERT INTO application_private.stock_commands VALUES(actor,p_command,payload,result);
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.correct_medication_purchase(uuid,numeric,date,text,text,text,bigint,uuid,text) FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.correct_medication_purchase(uuid,numeric,date,text,text,text,bigint,uuid,text) TO authenticated;
COMMENT ON TABLE public.medication_purchase_corrections IS 'Auditoria imutável para clientes: valores antes/depois, motivo e ajuste de estoque pela diferença. Sem apagar a compra original da trilha.';
COMMENT ON COLUMN public.medication_purchases.revision IS 'Controle de concorrência das correções. Atualização só pela RPC autorizada; clientes continuam sem escrita direta.';
