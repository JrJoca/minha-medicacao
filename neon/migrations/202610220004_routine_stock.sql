-- Ampliação aditiva. Registros antigos não recebem doses nem baixas retroativas.
ALTER TABLE public.medication_stock
  ADD COLUMN quantity numeric,
  ADD COLUMN quantity_per_package numeric,
  ADD COLUMN unit text CHECK (unit IN ('tablet','ml')),
  ADD CONSTRAINT stock_unit_required CHECK (unit IS NOT NULL OR (quantity IS NULL AND quantity_per_package IS NULL)),
  ADD CONSTRAINT stock_quantity_precision CHECK (quantity IS NULL OR (quantity = round(quantity,3) AND abs(quantity) <= 999999999.999)),
  ADD CONSTRAINT stock_package_precision CHECK (quantity_per_package IS NULL OR (quantity_per_package > 0 AND quantity_per_package = round(quantity_per_package,3) AND quantity_per_package <= 999999999.999));
ALTER TABLE public.medication_stock DISABLE TRIGGER medication_stock_updated_at;
UPDATE public.medication_stock SET quantity=total_tablets,quantity_per_package=tablets_per_box,
  unit=CASE WHEN total_tablets IS NOT NULL OR tablets_per_box IS NOT NULL OR tablets_per_day IS NOT NULL THEN 'tablet' END;
ALTER TABLE public.medication_stock ENABLE TRIGGER medication_stock_updated_at;
ALTER TABLE public.routine_medications
  ADD COLUMN quantity_per_intake numeric,
  ADD COLUMN quantity_unit text,
  ADD CONSTRAINT routine_dose_valid CHECK ((quantity_per_intake IS NULL AND quantity_unit IS NULL) OR
    (quantity_per_intake IS NOT NULL AND quantity_unit IS NOT NULL AND quantity_per_intake > 0 AND quantity_per_intake <= 999999999.999 AND quantity_per_intake=round(quantity_per_intake,3) AND quantity_unit IN ('tablet','ml')));
ALTER TABLE public.medication_routines
  ADD COLUMN stock_tracking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN frequency_kind text CHECK (frequency_kind IN ('daily','other')),
  ADD COLUMN archived_at timestamptz;
ALTER TABLE public.medication_intakes
  ADD COLUMN occurrence_date date,
  ADD COLUMN occurrence_timezone text,
  ADD COLUMN stock_managed boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX intake_managed_occurrence ON public.medication_intakes(user_id,routine_id,occurrence_date) WHERE stock_managed;

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  medication_id uuid NOT NULL,
  routine_id uuid,
  intake_id uuid,
  kind text NOT NULL CHECK (kind IN ('opening','adjustment','consumption','reversal')),
  quantity_delta numeric NOT NULL,
  unit text NOT NULL CHECK (unit IN ('tablet','ml')),
  applied_to_balance boolean NOT NULL,
  reverses_id uuid UNIQUE REFERENCES public.stock_movements(id),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(medication_id,user_id) REFERENCES public.medications(id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(routine_id,user_id) REFERENCES public.medication_routines(id,user_id) ON DELETE RESTRICT,
  CHECK ((kind='reversal')=(reverses_id IS NOT NULL)),
  CHECK ((kind='consumption' AND quantity_delta<0) OR (kind='reversal' AND quantity_delta>0) OR kind IN ('opening','adjustment'))
);
CREATE UNIQUE INDEX stock_consumption_once ON public.stock_movements(intake_id,medication_id) WHERE kind='consumption';
CREATE INDEX stock_movements_owner_medication ON public.stock_movements(user_id,medication_id,created_at);
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_movements FROM PUBLIC,anonymous,authenticated;
GRANT SELECT ON public.stock_movements TO authenticated;
CREATE POLICY stock_movement_read ON public.stock_movements FOR SELECT TO authenticated USING ((SELECT application_private.can_read(user_id)));
CREATE TABLE application_private.stock_commands (
  user_id uuid NOT NULL, command_id uuid NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(user_id,command_id)
);
ALTER TABLE application_private.stock_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON application_private.stock_commands FROM PUBLIC,anonymous,authenticated;

-- Os caminhos antigos continuam disponíveis para rotinas ainda não configuradas.
-- Depois da configuração, apenas as operações atômicas podem alterar a definição.
CREATE FUNCTION application_private.guard_stock_definition() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE managed boolean;
BEGIN
  IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='medication_stock' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Use a conferência de estoque; o histórico deve ser preservado.'; END IF;
    IF TG_OP='UPDATE' AND (NEW.medication_id<>OLD.medication_id OR NEW.user_id<>OLD.user_id) THEN RAISE EXCEPTION 'Identidade imutável.'; END IF;
    IF EXISTS(SELECT FROM public.stock_movements WHERE medication_id=NEW.medication_id) OR
       EXISTS(SELECT FROM public.routine_medications WHERE medication_id=NEW.medication_id AND quantity_per_intake IS NOT NULL) THEN
      RAISE EXCEPTION 'Atualize o aplicativo para conferir este estoque.';
    END IF;
    -- Compatibilidade com o formulário anterior, somente antes do rastreamento.
    NEW.quantity:=NEW.total_tablets; NEW.quantity_per_package:=NEW.tablets_per_box;
    NEW.unit:=CASE WHEN NEW.total_tablets IS NOT NULL OR NEW.tablets_per_box IS NOT NULL OR NEW.tablets_per_day IS NOT NULL THEN 'tablet' END;
  ELSIF TG_TABLE_NAME='medication_routines' THEN
    IF TG_OP='DELETE' THEN
      IF EXISTS(SELECT FROM public.medication_intakes WHERE routine_id=OLD.id) THEN RAISE EXCEPTION 'Arquive a rotina para preservar as tomadas.'; END IF;
      RETURN OLD;
    END IF;
    IF TG_OP='INSERT' THEN
      IF NEW.stock_tracking_enabled OR NEW.frequency_kind IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Use a configuração de doses.'; END IF;
    ELSE
      IF NEW.stock_tracking_enabled IS DISTINCT FROM OLD.stock_tracking_enabled OR NEW.frequency_kind IS DISTINCT FROM OLD.frequency_kind OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN RAISE EXCEPTION 'Use a configuração de doses.'; END IF;
      IF OLD.stock_tracking_enabled AND (to_jsonb(NEW)-ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at']) THEN RAISE EXCEPTION 'Atualize o aplicativo para editar as doses.'; END IF;
    END IF;
  ELSE
    IF TG_OP='DELETE' THEN managed:=OLD.quantity_per_intake IS NOT NULL;
    ELSE managed:=NEW.quantity_per_intake IS NOT NULL; END IF;
    IF TG_OP='UPDATE' THEN managed:=managed OR OLD.quantity_per_intake IS NOT NULL; END IF;
    IF TG_OP='DELETE' THEN
      managed:=managed OR EXISTS(SELECT FROM public.medication_routines WHERE id=OLD.routine_id AND stock_tracking_enabled);
    ELSE
      managed:=managed OR EXISTS(SELECT FROM public.medication_routines WHERE id=NEW.routine_id AND stock_tracking_enabled);
    END IF;
    IF managed THEN RAISE EXCEPTION 'Use a configuração de doses.'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE ALL ON FUNCTION application_private.guard_stock_definition() FROM PUBLIC;
CREATE TRIGGER guard_stock_definition BEFORE INSERT OR UPDATE OR DELETE ON public.medication_stock FOR EACH ROW EXECUTE FUNCTION application_private.guard_stock_definition();
CREATE TRIGGER guard_routine_definition BEFORE INSERT OR UPDATE OR DELETE ON public.medication_routines FOR EACH ROW EXECUTE FUNCTION application_private.guard_stock_definition();
CREATE TRIGGER guard_dose_definition BEFORE INSERT OR UPDATE OR DELETE ON public.routine_medications FOR EACH ROW EXECUTE FUNCTION application_private.guard_stock_definition();

CREATE FUNCTION application_private.stock_owner() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,application_private AS $$
DECLARE actor uuid;
BEGIN
  SELECT id INTO actor FROM application_private.accounts WHERE auth_subject=application_private.request_subject() AND is_active AND access_role='owner';
  IF actor IS NULL THEN RAISE EXCEPTION 'Perfil sem permissão para alterar dados.' USING ERRCODE='42501'; END IF;
  RETURN actor;
END; $$;
REVOKE ALL ON FUNCTION application_private.stock_owner() FROM PUBLIC,authenticated,anonymous;

CREATE FUNCTION public.save_routine_with_doses(p_routine_id uuid,p_definition jsonb,p_doses jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
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
    PERFORM 1 FROM public.medications WHERE id=d.medication_id AND user_id=actor FOR UPDATE;
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

-- Ajuste físico é explícito; nunca converte ml em comprimidos.
CREATE FUNCTION public.set_medication_inventory(p_medication_id uuid,p_quantity numeric,p_package numeric,p_unit text,p_command uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,application_private AS $$
DECLARE actor uuid:=application_private.stock_owner(); s public.medication_stock; payload jsonb; cached application_private.stock_commands;
BEGIN
  IF p_command IS NULL THEN RAISE EXCEPTION 'Operação inválida.'; END IF;
  payload:=jsonb_build_object('action','inventory','medication',p_medication_id,'quantity',p_quantity,'package',p_package,'unit',p_unit);
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_command::text,0));
  SELECT * INTO cached FROM application_private.stock_commands WHERE user_id=actor AND command_id=p_command;
  IF FOUND THEN
    IF cached.payload<>payload THEN RAISE EXCEPTION 'Identificador já utilizado em outra operação.'; END IF;
    RETURN;
  END IF;
  IF p_unit IS NULL OR p_unit NOT IN ('tablet','ml') OR (p_quantity IS NOT NULL AND (p_quantity<0 OR p_quantity>999999999.999 OR p_quantity<>round(p_quantity,3))) OR (p_package IS NOT NULL AND (p_package<=0 OR p_package>999999999.999 OR p_package<>round(p_package,3))) THEN RAISE EXCEPTION 'Saldo, embalagem ou unidade inválida.'; END IF;
  PERFORM 1 FROM public.medications WHERE id=p_medication_id AND user_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento indisponível.' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.medication_stock WHERE medication_id=p_medication_id FOR UPDATE;
  IF s.unit IS NOT NULL AND s.unit<>p_unit THEN RAISE EXCEPTION 'A unidade já foi definida. Cadastre outro medicamento para uma apresentação diferente.'; END IF;
  IF s.quantity IS NOT NULL AND p_quantity IS NULL THEN RAISE EXCEPTION 'Preserve o saldo informado; use zero para estoque esgotado.'; END IF;
  IF s.quantity IS NOT NULL AND NOT EXISTS(SELECT FROM public.stock_movements WHERE medication_id=p_medication_id AND applied_to_balance) THEN
    INSERT INTO public.stock_movements(user_id,medication_id,kind,quantity_delta,unit,applied_to_balance,snapshot) VALUES(actor,p_medication_id,'opening',s.quantity,p_unit,true,'{"source":"legacy_balance"}');
  END IF;
  IF p_quantity IS NOT NULL AND p_quantity IS DISTINCT FROM s.quantity THEN
    INSERT INTO public.stock_movements(user_id,medication_id,kind,quantity_delta,unit,applied_to_balance,snapshot)
    VALUES(actor,p_medication_id,CASE WHEN s.quantity IS NULL THEN 'opening' ELSE 'adjustment' END,p_quantity-coalesce(s.quantity,0),p_unit,true,jsonb_build_object('previous_quantity',s.quantity,'declared_quantity',p_quantity));
  END IF;
  INSERT INTO public.medication_stock(medication_id,user_id,quantity,quantity_per_package,unit,total_tablets,tablets_per_box)
  VALUES(p_medication_id,actor,p_quantity,p_package,p_unit,CASE WHEN p_unit='tablet' AND p_quantity=trunc(p_quantity) THEN p_quantity::integer END,CASE WHEN p_unit='tablet' AND p_package=trunc(p_package) THEN p_package::integer END)
  ON CONFLICT(medication_id) DO UPDATE SET quantity=excluded.quantity,quantity_per_package=excluded.quantity_per_package,unit=excluded.unit,total_tablets=excluded.total_tablets,tablets_per_box=excluded.tablets_per_box;
  INSERT INTO application_private.stock_commands VALUES(actor,p_command,payload,'{"saved":true}');
END; $$;

-- Todas as inserções/remoções (inclusive clientes antigos) passam pela mesma baixa.
CREATE FUNCTION application_private.intake_stock_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,application_private AS $$
DECLARE r public.medication_routines; target uuid;
BEGIN
  IF TG_OP='DELETE' THEN target:=OLD.routine_id; ELSE target:=NEW.routine_id; END IF;
  SELECT * INTO r FROM public.medication_routines WHERE id=target FOR UPDATE;
  IF NOT application_private.can_write(r.user_id) THEN RAISE EXCEPTION 'Tomada indisponível.' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN
      IF EXISTS(SELECT FROM public.medication_intakes WHERE routine_id=OLD.id) THEN RAISE EXCEPTION 'Arquive a rotina para preservar as tomadas.'; END IF;
      RETURN OLD;
    END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.routine_id<>OLD.routine_id OR NEW.stock_managed<>OLD.stock_managed OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Identidade da tomada imutável.'; END IF;
    NEW.occurrence_timezone:=OLD.occurrence_timezone;
    NEW.stock_managed:=OLD.stock_managed;
  ELSE
    NEW.stock_managed:=r.stock_tracking_enabled;
    IF r.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Rotina arquivada.'; END IF;
  END IF;
  IF NEW.stock_managed THEN
    NEW.occurrence_timezone:=coalesce(NEW.occurrence_timezone,'America/Sao_Paulo');
    IF NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=NEW.occurrence_timezone) THEN RAISE EXCEPTION 'Fuso horário inválido.'; END IF;
    NEW.occurrence_date:=(NEW.taken_at AT TIME ZONE NEW.occurrence_timezone)::date;
    IF EXISTS(SELECT FROM public.medication_intakes i WHERE i.routine_id=target AND i.id<>NEW.id AND (i.taken_at AT TIME ZONE NEW.occurrence_timezone)::date=NEW.occurrence_date) THEN RAISE EXCEPTION 'Já existe uma tomada nesta data.' USING ERRCODE='23505'; END IF;
    IF TG_OP='INSERT' AND (NOT EXISTS(SELECT FROM public.routine_medications WHERE routine_id=target) OR EXISTS(SELECT FROM public.routine_medications WHERE routine_id=target AND quantity_per_intake IS NULL)) THEN RAISE EXCEPTION 'Configure as quantidades da rotina antes de confirmar.'; END IF;
  ELSE
    NEW.occurrence_date:=NULL; NEW.occurrence_timezone:=NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION application_private.apply_intake_stock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,application_private AS $$
DECLARE d record; s public.medication_stock; amount numeric;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT NEW.stock_managed THEN RETURN NEW; END IF;
    FOR d IN SELECT rm.*,m.name,m.dosage FROM public.routine_medications rm JOIN public.medications m ON m.id=rm.medication_id WHERE rm.routine_id=NEW.routine_id ORDER BY rm.medication_id LOOP
      PERFORM 1 FROM public.medications WHERE id=d.medication_id FOR UPDATE;
      SELECT * INTO s FROM public.medication_stock WHERE medication_id=d.medication_id FOR UPDATE;
      IF s.unit IS DISTINCT FROM d.quantity_unit THEN RAISE EXCEPTION 'Unidades do estoque e da rotina são diferentes.'; END IF;
      IF s.quantity IS NOT NULL AND NOT EXISTS(SELECT FROM public.stock_movements WHERE medication_id=d.medication_id AND applied_to_balance) THEN
        INSERT INTO public.stock_movements(user_id,medication_id,kind,quantity_delta,unit,applied_to_balance,snapshot) VALUES(NEW.user_id,d.medication_id,'opening',s.quantity,s.unit,true,'{"source":"legacy_balance"}');
      END IF;
      INSERT INTO public.stock_movements(user_id,medication_id,routine_id,intake_id,kind,quantity_delta,unit,applied_to_balance,snapshot)
      VALUES(NEW.user_id,d.medication_id,NEW.routine_id,NEW.id,'consumption',-d.quantity_per_intake,d.quantity_unit,s.quantity IS NOT NULL,jsonb_build_object('name',d.name,'dosage',d.dosage,'taken_at',NEW.taken_at,'quantity',d.quantity_per_intake,'occurrence_date',NEW.occurrence_date));
      amount:=s.quantity-d.quantity_per_intake;
      UPDATE public.medication_stock SET quantity=amount,total_tablets=CASE WHEN s.unit='tablet' AND amount>=0 AND amount=trunc(amount) THEN amount::integer END WHERE medication_id=d.medication_id;
    END LOOP;
    RETURN NEW;
  END IF;
  FOR d IN SELECT * FROM public.stock_movements WHERE intake_id=OLD.id AND kind='consumption' ORDER BY medication_id LOOP
    PERFORM 1 FROM public.medications WHERE id=d.medication_id FOR UPDATE;
    SELECT * INTO s FROM public.medication_stock WHERE medication_id=d.medication_id FOR UPDATE;
    INSERT INTO public.stock_movements(user_id,medication_id,routine_id,intake_id,kind,quantity_delta,unit,applied_to_balance,reverses_id,snapshot)
    VALUES(d.user_id,d.medication_id,d.routine_id,d.intake_id,'reversal',-d.quantity_delta,d.unit,d.applied_to_balance,d.id,d.snapshot);
    IF d.applied_to_balance THEN
      amount:=s.quantity-d.quantity_delta;
      UPDATE public.medication_stock SET quantity=amount,total_tablets=CASE WHEN s.unit='tablet' AND amount>=0 AND amount=trunc(amount) THEN amount::integer END WHERE medication_id=d.medication_id;
    END IF;
  END LOOP;
  RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION application_private.intake_stock_guard(),application_private.apply_intake_stock() FROM PUBLIC,authenticated,anonymous;
CREATE TRIGGER intake_stock_guard BEFORE INSERT OR UPDATE OR DELETE ON public.medication_intakes FOR EACH ROW EXECUTE FUNCTION application_private.intake_stock_guard();
CREATE TRIGGER intake_stock_apply AFTER INSERT OR DELETE ON public.medication_intakes FOR EACH ROW EXECUTE FUNCTION application_private.apply_intake_stock();

CREATE FUNCTION public.change_routine_intake(p_command uuid,p_routine_id uuid,p_action text,p_taken_at timestamptz,p_timezone text,p_intake_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,application_private AS $$
DECLARE actor uuid:=application_private.stock_owner(); payload jsonb; cached application_private.stock_commands; i public.medication_intakes; result jsonb; r public.medication_routines;
BEGIN
  IF p_command IS NULL OR p_taken_at IS NULL OR NOT isfinite(p_taken_at) OR p_timezone IS NULL OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=p_timezone) OR p_action IS NULL OR p_action NOT IN ('confirm','undo','correct') THEN RAISE EXCEPTION 'Operação inválida.'; END IF;
  payload:=jsonb_build_object('routine',p_routine_id,'action',p_action,'taken_at',p_taken_at,'timezone',p_timezone,'intake',p_intake_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_command::text,0));
  SELECT * INTO cached FROM application_private.stock_commands WHERE user_id=actor AND command_id=p_command;
  IF FOUND THEN
    IF cached.payload<>payload THEN RAISE EXCEPTION 'Identificador já utilizado em outra operação.'; END IF;
    RETURN cached.result;
  END IF;
  SELECT * INTO r FROM public.medication_routines WHERE id=p_routine_id AND user_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rotina indisponível.' USING ERRCODE='42501'; END IF;
  IF p_action='confirm' THEN
    IF NOT r.stock_tracking_enabled THEN RAISE EXCEPTION 'Configure as quantidades da rotina antes de confirmar.'; END IF;
    SELECT * INTO i FROM public.medication_intakes WHERE routine_id=p_routine_id AND (taken_at AT TIME ZONE p_timezone)::date=(p_taken_at AT TIME ZONE p_timezone)::date ORDER BY taken_at LIMIT 1;
    IF NOT FOUND THEN INSERT INTO public.medication_intakes(user_id,routine_id,taken_at,occurrence_timezone) VALUES(actor,p_routine_id,p_taken_at,p_timezone) RETURNING * INTO i; END IF;
  ELSE
    SELECT * INTO i FROM public.medication_intakes WHERE id=p_intake_id AND routine_id=p_routine_id AND user_id=actor FOR UPDATE;
    IF p_action='undo' THEN DELETE FROM public.medication_intakes WHERE id=i.id;
    ELSE
      IF i.id IS NULL THEN RAISE EXCEPTION 'Tomada não encontrada.'; END IF;
      IF EXISTS(SELECT FROM public.medication_intakes x WHERE x.routine_id=p_routine_id AND x.id<>i.id AND (x.taken_at AT TIME ZONE p_timezone)::date=(p_taken_at AT TIME ZONE p_timezone)::date) THEN RAISE EXCEPTION 'Já existe uma tomada nesta data.'; END IF;
      UPDATE public.medication_intakes SET taken_at=p_taken_at WHERE id=i.id RETURNING * INTO i;
    END IF;
  END IF;
  result:=jsonb_build_object('id',i.id,'taken_at',i.taken_at,'stock_managed',i.stock_managed);
  INSERT INTO application_private.stock_commands VALUES(actor,p_command,payload,result);
  RETURN result;
END; $$;

CREATE FUNCTION public.archive_medication_routine(p_routine_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,application_private AS $$
DECLARE actor uuid:=application_private.stock_owner();
BEGIN
  PERFORM 1 FROM public.medication_routines WHERE id=p_routine_id AND user_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rotina indisponível.' USING ERRCODE='42501'; END IF;
  UPDATE public.medication_routines SET archived_at=clock_timestamp(),status='paused' WHERE id=p_routine_id;
END; $$;
CREATE FUNCTION public.inventory_summary() RETURNS TABLE(medication_id uuid,user_id uuid,quantity numeric,quantity_per_package numeric,unit text,daily_quantity numeric,estimated_days numeric,full_days_covered bigint) LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
  WITH daily AS (
    SELECT rm.medication_id,
      CASE WHEN bool_and(r.stock_tracking_enabled AND r.frequency_kind='daily' AND rm.quantity_per_intake IS NOT NULL) THEN sum(rm.quantity_per_intake) END AS amount
    FROM public.routine_medications rm JOIN public.medication_routines r ON r.id=rm.routine_id
    WHERE r.status='active' AND r.archived_at IS NULL GROUP BY rm.medication_id
  )
  SELECT m.id,m.user_id,s.quantity,s.quantity_per_package,s.unit,d.amount,
    CASE WHEN s.quantity IS NOT NULL THEN greatest(s.quantity,0)/nullif(d.amount,0) END,CASE WHEN s.quantity IS NOT NULL THEN floor(greatest(s.quantity,0)/nullif(d.amount,0))::bigint END
  FROM public.medications m LEFT JOIN public.medication_stock s ON s.medication_id=m.id LEFT JOIN daily d ON d.medication_id=m.id;
$$;
REVOKE ALL ON FUNCTION public.save_routine_with_doses(uuid,jsonb,jsonb),public.set_medication_inventory(uuid,numeric,numeric,text,uuid),public.change_routine_intake(uuid,uuid,text,timestamptz,text,uuid),public.archive_medication_routine(uuid),public.inventory_summary() FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.save_routine_with_doses(uuid,jsonb,jsonb),public.set_medication_inventory(uuid,numeric,numeric,text,uuid),public.change_routine_intake(uuid,uuid,text,timestamptz,text,uuid),public.archive_medication_routine(uuid),public.inventory_summary() TO authenticated;

COMMENT ON TABLE public.medication_stock IS 'Saldo físico em comprimidos ou ml; baixas e estornos atômicos por tomada configurada. NULL é desconhecido; saldo negativo sinaliza divergência.';
COMMENT ON COLUMN public.medication_stock.tablets_per_day IS 'Campo legado preservado. A nova previsão usa as quantidades das rotinas diárias ativas.';
COMMENT ON TABLE public.stock_movements IS 'Trilha imutável para clientes; snapshots de consumo e estorno da quantidade original. Sem baixas retroativas.';
