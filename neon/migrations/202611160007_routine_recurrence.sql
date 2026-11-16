-- 007: Calendário estruturado, SEM retroatividade e SEM backfill clínico.
-- Executar SOMENTE após ensaio, backup e autorização para o ambiente alvo.
-- Todas as rotinas existentes mantêm recurrence_rule = NULL.
ALTER TABLE public.medication_routines
  ADD COLUMN recurrence_rule jsonb,
  ADD COLUMN recurrence_timezone text,
  ADD CONSTRAINT medication_routines_schedule_pair
  CHECK ((recurrence_rule IS NULL) = (recurrence_timezone IS NULL));

-- Função de validação interna para a mesma operação transacional de salvar doses.
CREATE FUNCTION application_private.validate_medication_recurrence(p_rule jsonb, p_timezone text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, application_private
AS $schedule$
DECLARE
  kind text;
  start_date date;
  end_date date;
  weekday_count integer;
  weekday_distinct integer;
BEGIN
  IF p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object' THEN
    RAISE EXCEPTION 'Calendário de tratamento inválido.';
  END IF;
  IF p_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Fuso horário do calendário inválido.';
  END IF;
  kind := p_rule->>'kind';
  IF kind IS NULL OR kind NOT IN ('daily','weekdays','interval') THEN
    RAISE EXCEPTION 'Tipo de recorrência não suportado.';
  END IF;
  IF p_rule->>'startDate' IS NULL OR
     p_rule->>'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Data inicial inválida.';
  END IF;
  start_date := (p_rule->>'startDate')::date;
  IF start_date < DATE '1900-01-01' OR start_date > DATE '9999-12-31' OR
     to_char(start_date,'YYYY-MM-DD') <> p_rule->>'startDate' THEN
    RAISE EXCEPTION 'Data inicial fora do intervalo permitido.';
  END IF;
  IF p_rule ? 'endDate' AND jsonb_typeof(p_rule->'endDate') <> 'null' THEN
    IF p_rule->>'endDate' IS NULL OR
       p_rule->>'endDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Data final inválida.';
    END IF;
    end_date := (p_rule->>'endDate')::date;
    IF end_date < start_date OR end_date > DATE '9999-12-31' OR
       to_char(end_date,'YYYY-MM-DD') <> p_rule->>'endDate' THEN
      RAISE EXCEPTION 'Fim de tratamento inválido.';
    END IF;
  END IF;
  IF kind = 'weekdays' THEN
    IF jsonb_typeof(p_rule->'weekdays') <> 'array' THEN
      RAISE EXCEPTION 'Escolha os dias da semana.';
    END IF;
    SELECT count(*), count(DISTINCT e.value) INTO weekday_count,weekday_distinct
    FROM jsonb_array_elements(p_rule->'weekdays') e(value)
    WHERE jsonb_typeof(e.value)='number' AND e.value::text ~ '^[0-6]$';
    IF weekday_count < 1 OR weekday_count > 7 OR weekday_count <> weekday_distinct OR
       weekday_count <> jsonb_array_length(p_rule->'weekdays') THEN
      RAISE EXCEPTION 'Dias da semana inválidos ou repetidos.';
    END IF;
  ELSIF kind='interval' THEN
    IF jsonb_typeof(p_rule->'everyDays') <> 'number' OR
       (p_rule->>'everyDays') !~ '^[0-9]{1,4}$' OR
       (p_rule->>'everyDays')::integer NOT BETWEEN 1 AND 3650 THEN
      RAISE EXCEPTION 'Intervalo inválido (1 a 3650 dias).';
    END IF;
  END IF;
END;
$schedule$;
REVOKE ALL ON FUNCTION application_private.validate_medication_recurrence(jsonb,text) FROM PUBLIC,anonymous,authenticated;

-- Versão transacional e idempotente da rotina: idêntica à 005, com calendário
-- adicionado à mesma instrução INSERT/UPSERT. Mantém IDs, doses e isolamento.
CREATE OR REPLACE FUNCTION public.save_routine_with_doses(p_routine_id uuid,p_definition jsonb,p_doses jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,application_private AS $$
DECLARE actor uuid:=application_private.stock_owner(); rid uuid:=coalesce(p_routine_id,gen_random_uuid()); d record; existing public.medication_routines; s public.medication_stock; command uuid:=(p_definition->>'command_id')::uuid; payload jsonb; cached application_private.stock_commands; recurrence_rule_new jsonb; recurrence_timezone_new text;
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
  -- Campos opcionais: chamadas antigas preservam recorrência estruturada existente.
  -- Informar JSON null explicitamente remove o calendário (após confirmação na UI).
  IF p_definition ? 'recurrence_rule' THEN
    recurrence_rule_new := p_definition->'recurrence_rule';
    IF jsonb_typeof(recurrence_rule_new)='null' THEN recurrence_rule_new:=NULL; END IF;
    recurrence_timezone_new := CASE WHEN recurrence_rule_new IS NULL THEN NULL ELSE p_definition->>'recurrence_timezone' END;
  ELSE
    recurrence_rule_new := existing.recurrence_rule;
    recurrence_timezone_new := existing.recurrence_timezone;
  END IF;
  IF recurrence_rule_new IS NOT NULL THEN
    PERFORM application_private.validate_medication_recurrence(recurrence_rule_new,recurrence_timezone_new);
  END IF;
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
  INSERT INTO public.medication_routines(id,user_id,name,period_description,has_no_end_date,duration_value,duration_unit,total_days,scheduled_time,deadline_time,stock_tracking_enabled,frequency_kind,recurrence_rule,recurrence_timezone)
  VALUES(rid,actor,p_definition->>'name',p_definition->>'period_description',(p_definition->>'has_no_end_date')::boolean,(p_definition->>'duration_value')::integer,p_definition->>'duration_unit',(p_definition->>'total_days')::integer,(p_definition->>'scheduled_time')::time,(p_definition->>'deadline_time')::time,true,p_definition->>'frequency_kind',recurrence_rule_new,recurrence_timezone_new)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,period_description=excluded.period_description,has_no_end_date=excluded.has_no_end_date,duration_value=excluded.duration_value,duration_unit=excluded.duration_unit,total_days=excluded.total_days,scheduled_time=excluded.scheduled_time,deadline_time=excluded.deadline_time,stock_tracking_enabled=true,frequency_kind=excluded.frequency_kind,recurrence_rule=excluded.recurrence_rule,recurrence_timezone=excluded.recurrence_timezone,updated_at=clock_timestamp();
  DELETE FROM public.routine_medications WHERE routine_id=rid;
  INSERT INTO public.routine_medications(user_id,routine_id,medication_id,quantity_per_intake,quantity_unit)
  SELECT actor,rid,x.medication_id,x.quantity,x.unit FROM jsonb_to_recordset(p_doses) AS x(medication_id uuid,quantity numeric,unit text);
  INSERT INTO application_private.stock_commands VALUES(actor,command,payload,jsonb_build_object('id',rid));
  RETURN rid;
END; $$;

-- IMPORTANTE: os grants da função existente são preservados por CREATE OR REPLACE.
-- Não acrescentar acesso irrestrito às novas colunas ou às funções internas.
