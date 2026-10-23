-- Todos os cadastros existentes continuam ativos. Nenhuma compra é inferida.
ALTER TABLE public.medications ADD COLUMN is_active boolean NOT NULL DEFAULT true;

CREATE TABLE public.medication_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  medication_id uuid NOT NULL,
  quantity numeric NOT NULL CHECK (quantity>0 AND quantity<=999999999.999 AND quantity=round(quantity,3)),
  unit text NOT NULL CHECK (unit IN ('tablet','ml')),
  purchased_on date NOT NULL CHECK (isfinite(purchased_on)),
  pharmacy text NOT NULL CHECK (length(btrim(pharmacy)) BETWEEN 1 AND 160),
  reference_url text CHECK (reference_url IS NULL OR (length(reference_url)<=2048 AND reference_url ~* '^https?://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,user_id),
  FOREIGN KEY(medication_id,user_id) REFERENCES public.medications(id,user_id) ON DELETE RESTRICT
);
CREATE INDEX medication_purchases_owner_date ON public.medication_purchases(user_id,medication_id,purchased_on DESC,created_at DESC);
ALTER TABLE public.medication_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medication_purchases FROM PUBLIC,anonymous,authenticated;
GRANT SELECT ON public.medication_purchases TO authenticated;
CREATE POLICY purchase_read ON public.medication_purchases FOR SELECT TO authenticated
  USING ((SELECT application_private.can_read(user_id)));

ALTER TABLE public.stock_movements
  ADD COLUMN purchase_id uuid,
  ADD CONSTRAINT movement_purchase_owner FOREIGN KEY(purchase_id,user_id) REFERENCES public.medication_purchases(id,user_id) ON DELETE RESTRICT,
  DROP CONSTRAINT stock_movements_kind_check,
  DROP CONSTRAINT stock_movements_check1,
  ADD CONSTRAINT movement_kind CHECK (kind IN ('opening','adjustment','purchase','consumption','reversal')),
  ADD CONSTRAINT movement_amount CHECK (
    (kind='consumption' AND quantity_delta<0) OR
    (kind IN ('reversal','purchase') AND quantity_delta>0) OR kind IN ('opening','adjustment')),
  ADD CONSTRAINT movement_purchase CHECK ((kind='purchase')=(purchase_id IS NOT NULL));
CREATE UNIQUE INDEX stock_purchase_once ON public.stock_movements(purchase_id) WHERE kind='purchase';

CREATE FUNCTION public.set_medication_active(p_medication_id uuid,p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,application_private AS $$
DECLARE actor uuid:=application_private.stock_owner();
BEGIN
  IF p_active IS NULL THEN RAISE EXCEPTION 'Informe a situação do medicamento.'; END IF;
  PERFORM 1 FROM public.medications WHERE id=p_medication_id AND user_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento indisponível.' USING ERRCODE='42501'; END IF;
  UPDATE public.medications SET is_active=p_active WHERE id=p_medication_id;
END; $$;

-- Clientes anteriores também não podem adicionar um medicamento desativado.
-- O cadastro de doses valida a situação antes de substituir os vínculos.
CREATE FUNCTION application_private.guard_active_medication() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.routine_id=OLD.routine_id AND NEW.medication_id=OLD.medication_id THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT FROM public.medications WHERE id=NEW.medication_id AND user_id=NEW.user_id AND is_active) THEN
    RAISE EXCEPTION 'Selecione um medicamento ativo para adicionar à rotina.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION application_private.guard_active_medication() FROM PUBLIC,anonymous,authenticated;
CREATE TRIGGER guard_active_medication BEFORE INSERT OR UPDATE ON public.routine_medications
  FOR EACH ROW EXECUTE FUNCTION application_private.guard_active_medication();

CREATE OR REPLACE FUNCTION public.save_routine_with_doses(p_routine_id uuid,p_definition jsonb,p_doses jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,application_private AS $$
DECLARE actor uuid:=application_private.stock_owner(); rid uuid:=coalesce(p_routine_id,gen_random_uuid()); d record; existing public.medication_routines; s public.medication_stock; command uuid:=(p_definition->>'command_id')::uuid; payload jsonb; cached application_private.stock_commands;
BEGIN
  IF command IS NULL THEN RAISE EXCEPTION 'Operação inválida.'; END IF;
  payload:=jsonb_build_object('action','save_routine','routine',p_routine_id,'definition',p_definition,'doses',p_doses);
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||command::text,0));
  SELECT * INTO cached FROM application_private.stock_commands WHERE user_id=actor AND command_id=command;
  IF FOUND THEN
    IF cached.payload<>payload THEN RAISE EXCEPTION 'Identificador já utilizado em outra operação.'; END IF;
    RETURN (cached.result->>'id')::uuid;
  END IF;
  IF p_doses IS NULL OR jsonb_typeof(p_doses)<>'array' OR jsonb_array_length(p_doses)=0 OR jsonb_array_length(p_doses)>100 THEN RAISE EXCEPTION 'Informe as quantidades dos medicamentos.'; END IF;
  IF p_routine_id IS NOT NULL THEN
    SELECT * INTO existing FROM public.medication_routines WHERE id=rid AND user_id=actor AND archived_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rotina indisponível.' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_definition->>'frequency_kind' IS NULL OR p_definition->>'frequency_kind' NOT IN ('daily','other') THEN RAISE EXCEPTION 'Informe a frequência.'; END IF;
  IF (SELECT count(DISTINCT x->>'medication_id') FROM jsonb_array_elements(p_doses) x)<>jsonb_array_length(p_doses) THEN RAISE EXCEPTION 'Medicamento repetido.'; END IF;
  FOR d IN SELECT * FROM jsonb_to_recordset(p_doses) AS x(medication_id uuid,quantity numeric,unit text) ORDER BY medication_id LOOP
    IF d.quantity IS NULL OR d.quantity<=0 OR d.quantity>999999999.999 OR d.quantity<>round(d.quantity,3) OR d.unit IS NULL OR d.unit NOT IN ('tablet','ml') THEN RAISE EXCEPTION 'Quantidade ou unidade inválida.'; END IF;
    PERFORM 1 FROM public.medications m WHERE m.id=d.medication_id AND m.user_id=actor
      AND (m.is_active OR (p_routine_id IS NOT NULL AND EXISTS(
        SELECT FROM public.routine_medications rm WHERE rm.routine_id=rid AND rm.medication_id=m.id))) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um medicamento ativo; medicamentos desativados só podem ser mantidos nas rotinas existentes.' USING ERRCODE='42501'; END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento indisponível.' USING ERRCODE='42501'; END IF;
    SELECT * INTO s FROM public.medication_stock WHERE medication_id=d.medication_id FOR UPDATE;
    IF s.unit IS NOT NULL AND s.unit<>d.unit THEN RAISE EXCEPTION 'A unidade da rotina deve ser igual à unidade do estoque.'; END IF;
    IF EXISTS(SELECT FROM public.routine_medications WHERE medication_id=d.medication_id AND quantity_unit<>d.unit) THEN RAISE EXCEPTION 'Este medicamento já utiliza outra unidade.'; END IF;
    INSERT INTO public.medication_stock(medication_id,user_id,unit) VALUES(d.medication_id,actor,d.unit) ON CONFLICT(medication_id) DO UPDATE SET unit=excluded.unit;
  END LOOP;
  INSERT INTO public.medication_routines(id,user_id,name,period_description,has_no_end_date,duration_value,duration_unit,total_days,scheduled_time,deadline_time,stock_tracking_enabled,frequency_kind)
  VALUES(rid,actor,p_definition->>'name',p_definition->>'period_description',(p_definition->>'has_no_end_date')::boolean,(p_definition->>'duration_value')::integer,p_definition->>'duration_unit',(p_definition->>'total_days')::integer,(p_definition->>'scheduled_time')::time,(p_definition->>'deadline_time')::time,true,p_definition->>'frequency_kind')
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,period_description=excluded.period_description,has_no_end_date=excluded.has_no_end_date,duration_value=excluded.duration_value,duration_unit=excluded.duration_unit,total_days=excluded.total_days,scheduled_time=excluded.scheduled_time,deadline_time=excluded.deadline_time,stock_tracking_enabled=true,frequency_kind=excluded.frequency_kind,updated_at=clock_timestamp();
  DELETE FROM public.routine_medications WHERE routine_id=rid;
  INSERT INTO public.routine_medications(user_id,routine_id,medication_id,quantity_per_intake,quantity_unit)
  SELECT actor,rid,x.medication_id,x.quantity,x.unit FROM jsonb_to_recordset(p_doses) AS x(medication_id uuid,quantity numeric,unit text);
  INSERT INTO application_private.stock_commands VALUES(actor,command,payload,jsonb_build_object('id',rid));
  RETURN rid;
END; $$;


CREATE FUNCTION public.record_medication_purchase(
  p_medication_id uuid,p_quantity numeric,p_unit text,p_purchased_on date,
  p_pharmacy text,p_reference_url text,p_command uuid,p_timezone text DEFAULT 'America/Sao_Paulo'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,application_private AS $$
DECLARE actor uuid:=application_private.stock_owner(); s public.medication_stock;
  payload jsonb; cached application_private.stock_commands; purchase uuid; amount numeric;
BEGIN
  IF p_command IS NULL THEN RAISE EXCEPTION 'Operação inválida.'; END IF;
  payload:=jsonb_build_object('action','purchase','medication',p_medication_id,'quantity',p_quantity,
    'unit',p_unit,'purchased_on',p_purchased_on,'pharmacy',p_pharmacy,'reference_url',p_reference_url,'timezone',p_timezone);
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_command::text,0));
  SELECT * INTO cached FROM application_private.stock_commands WHERE user_id=actor AND command_id=p_command;
  IF FOUND THEN
    IF cached.payload<>payload THEN RAISE EXCEPTION 'Identificador já utilizado em outra operação.'; END IF;
    RETURN (cached.result->>'id')::uuid;
  END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity>999999999.999 OR p_quantity<>round(p_quantity,3)
     OR p_unit IS NULL OR p_unit NOT IN ('tablet','ml') THEN RAISE EXCEPTION 'Informe a quantidade comprada e a unidade.'; END IF;
  IF p_timezone IS NULL OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Fuso horário inválido.'; END IF;
  IF p_purchased_on IS NULL OR NOT isfinite(p_purchased_on) OR p_purchased_on>(now() AT TIME ZONE p_timezone)::date THEN
    RAISE EXCEPTION 'Informe uma data de compra válida, até hoje.'; END IF;
  IF p_pharmacy IS NULL OR length(btrim(p_pharmacy)) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Informe a farmácia.'; END IF;
  PERFORM 1 FROM public.medications WHERE id=p_medication_id AND user_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento indisponível.' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.medication_stock WHERE medication_id=p_medication_id FOR UPDATE;
  IF s.quantity IS NULL THEN RAISE EXCEPTION 'Confira o saldo físico antes de registrar a primeira compra.'; END IF;
  IF s.unit IS DISTINCT FROM p_unit THEN RAISE EXCEPTION 'A unidade da compra deve ser igual à do estoque.'; END IF;
  amount:=s.quantity+p_quantity;
  IF amount>999999999.999 THEN RAISE EXCEPTION 'O saldo excede o limite permitido.'; END IF;
  INSERT INTO public.medication_purchases(user_id,medication_id,quantity,unit,purchased_on,pharmacy,reference_url)
    VALUES(actor,p_medication_id,p_quantity,p_unit,p_purchased_on,btrim(p_pharmacy),nullif(btrim(p_reference_url),''))
    RETURNING id INTO purchase;
  IF NOT EXISTS(SELECT FROM public.stock_movements WHERE medication_id=p_medication_id AND applied_to_balance) THEN
    INSERT INTO public.stock_movements(user_id,medication_id,kind,quantity_delta,unit,applied_to_balance,snapshot)
      VALUES(actor,p_medication_id,'opening',s.quantity,s.unit,true,'{"source":"legacy_balance"}');
  END IF;
  INSERT INTO public.stock_movements(user_id,medication_id,purchase_id,kind,quantity_delta,unit,applied_to_balance,snapshot)
    VALUES(actor,p_medication_id,purchase,'purchase',p_quantity,p_unit,true,
      jsonb_build_object('purchased_on',p_purchased_on,'pharmacy',btrim(p_pharmacy),'reference_url',nullif(btrim(p_reference_url),'')));
  UPDATE public.medication_stock SET quantity=amount,
    total_tablets=CASE WHEN s.unit='tablet' AND amount>=0 AND amount=trunc(amount) THEN amount::integer END
    WHERE medication_id=p_medication_id;
  INSERT INTO application_private.stock_commands VALUES(actor,p_command,payload,jsonb_build_object('id',purchase));
  RETURN purchase;
END; $$;

REVOKE ALL ON FUNCTION public.set_medication_active(uuid,boolean),
  public.record_medication_purchase(uuid,numeric,text,date,text,text,uuid,text) FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.set_medication_active(uuid,boolean),
  public.record_medication_purchase(uuid,numeric,text,date,text,text,uuid,text) TO authenticated;

COMMENT ON COLUMN public.medications.is_active IS 'Disponível para novas rotinas. Desativação preserva vínculos, tomadas e estoques existentes.';
COMMENT ON TABLE public.medication_purchases IS 'Compras imutáveis para clientes, com entrada atômica e idempotente no estoque. Não representa saldo físico total.';
