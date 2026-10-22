-- Aplicação autorizada somente durante a janela de corte, depois do backup.
-- Uma transação aguarda escritores anteriores e instala a barreira sem lacuna.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.medications, public.medication_routines,
  public.routine_medications, public.medication_intakes IN SHARE ROW EXCLUSIVE MODE;
CREATE SCHEMA medication_cutover_private;
REVOKE ALL ON SCHEMA medication_cutover_private FROM PUBLIC;
CREATE TABLE medication_cutover_private.control (
  singleton boolean PRIMARY KEY CHECK(singleton),
  frozen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON medication_cutover_private.control FROM PUBLIC;
INSERT INTO medication_cutover_private.control(singleton) VALUES(true);
CREATE FUNCTION medication_cutover_private.reject_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION USING ERRCODE='55000',
    MESSAGE='Migração em andamento. Atualize a aplicação antes de registrar alterações.';
END; $$;
REVOKE ALL ON FUNCTION medication_cutover_private.reject_write() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['medications','medication_routines','routine_medications','medication_intakes'] LOOP
    EXECUTE format('CREATE TRIGGER medication_neon_cutover BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION medication_cutover_private.reject_write()',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER medication_neon_cutover',t);
  END LOOP;
END; $$;
COMMIT;
