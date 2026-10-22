-- Aplicar somente num Neon de ensaio vazio.
-- O executor deve executar TODOS os comandos em uma única transação.
-- Não reaplicar sobre tabelas existentes; nenhuma tabela do Supabase é alterada.

-- Permite importar antes de escolher/provisionar o login. Não cria usuários de
-- autenticação nem concede bypass de RLS. Para restauração remota, provisionar
-- Auth/Data API ANTES deste SQL: o serviço recusa roles de API preexistentes.
DO $api_roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anonymous') THEN
    CREATE ROLE anonymous NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT FROM pg_roles WHERE rolname IN ('authenticated', 'anonymous')
      AND (rolsuper OR rolbypassrls OR rolcanlogin)
  ) THEN
    RAISE EXCEPTION 'API roles must have NOLOGIN, NOSUPERUSER and NOBYPASSRLS';
  END IF;
END;
$api_roles$;

CREATE SCHEMA application_private;
REVOKE ALL ON SCHEMA application_private FROM PUBLIC;

-- IDs da aplicação permanecem iguais aos do Supabase. O subject do novo login
-- é vinculado separadamente, por administração, nunca pelo cliente.
CREATE TABLE application_private.accounts (
  id uuid PRIMARY KEY,
  auth_subject text UNIQUE CHECK (length(auth_subject) BETWEEN 1 AND 256),
  source_email text NOT NULL UNIQUE,
  access_role text NOT NULL CHECK (access_role IN ('owner', 'viewer')),
  owner_user_id uuid REFERENCES application_private.accounts(id)
    DEFERRABLE INITIALLY DEFERRED,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((access_role = 'owner' AND owner_user_id IS NULL)
    OR (access_role = 'viewer' AND owner_user_id IS NOT NULL AND owner_user_id <> id))
);

CREATE TABLE application_private.migration_runs (
  snapshot_sha256 text PRIMARY KEY CHECK (length(snapshot_sha256) = 64),
  source_project text NOT NULL,
  exported_at timestamptz NOT NULL,
  restored_at timestamptz NOT NULL DEFAULT now()
);

-- Sem o serviço oficial, não há identidade: o resultado NULL fecha o acesso.
-- Não ler GUCs/JWTs diretamente nem fabricar subjects para liberar a importação.
CREATE FUNCTION application_private.request_subject()
RETURNS text LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, application_private
AS $$
BEGIN
  IF to_regprocedure('auth.user_id()') IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN auth.user_id();
END;
$$;
REVOKE ALL ON FUNCTION application_private.request_subject() FROM PUBLIC;

CREATE FUNCTION application_private.can_read(data_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, application_private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM application_private.accounts a
    WHERE a.auth_subject = (SELECT application_private.request_subject()) AND a.is_active
      AND (a.id = data_owner
        OR (a.access_role = 'viewer' AND a.owner_user_id = data_owner))
  );
$$;

CREATE FUNCTION application_private.can_write(data_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, application_private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM application_private.accounts a
    WHERE a.auth_subject = (SELECT application_private.request_subject()) AND a.is_active
      AND a.id = data_owner AND a.access_role = 'owner'
  );
$$;

CREATE FUNCTION public.application_context()
RETURNS TABLE (user_id uuid, role text, owner_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, application_private
AS $$
  SELECT a.id, a.access_role, a.owner_user_id
  FROM application_private.accounts a
  WHERE a.auth_subject = (SELECT application_private.request_subject()) AND a.is_active;
$$;

CREATE TABLE public.medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES application_private.accounts(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  dosage text NOT NULL,
  reference_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE TABLE public.medication_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES application_private.accounts(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  period_description text NOT NULL,
  has_no_end_date boolean NOT NULL DEFAULT false,
  duration_value integer CHECK (duration_value IS NULL OR duration_value > 0),
  duration_unit text CHECK (duration_unit IS NULL OR duration_unit IN ('days', 'weeks')),
  current_day integer NOT NULL DEFAULT 1 CHECK (current_day > 0),
  total_days integer,
  CONSTRAINT medication_routines_duration_check CHECK (
    (has_no_end_date AND duration_value IS NULL AND duration_unit IS NULL AND total_days IS NULL)
    OR (NOT has_no_end_date AND duration_value > 0 AND duration_unit IS NOT NULL
      AND total_days > 0 AND current_day <= total_days)
  ),
  scheduled_time time NOT NULL,
  deadline_time time NOT NULL,
  reminders_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE TABLE public.routine_medications (
  user_id uuid NOT NULL REFERENCES application_private.accounts(id),
  routine_id uuid NOT NULL,
  medication_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (routine_id, medication_id),
  FOREIGN KEY (routine_id, user_id)
    REFERENCES public.medication_routines(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (medication_id, user_id)
    REFERENCES public.medications(id, user_id) ON DELETE CASCADE
);

CREATE TABLE public.medication_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES application_private.accounts(id),
  routine_id uuid NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (routine_id, user_id)
    REFERENCES public.medication_routines(id, user_id) ON DELETE CASCADE
);

CREATE INDEX medications_user_id_idx ON public.medications(user_id);
CREATE INDEX medication_routines_user_id_idx ON public.medication_routines(user_id);
CREATE INDEX routine_medications_user_id_idx ON public.routine_medications(user_id);
CREATE INDEX medication_intakes_user_routine_idx
  ON public.medication_intakes(user_id, routine_id, taken_at DESC);

-- Grants explícitos, sem liberar indiscriminadamente tabelas futuras.
GRANT USAGE ON SCHEMA public, application_private TO authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA application_private FROM PUBLIC, authenticated, anonymous;
REVOKE ALL ON FUNCTION application_private.can_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION application_private.can_write(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.application_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION application_private.can_read(uuid),
  application_private.can_write(uuid), public.application_context() TO authenticated;

DO $policies$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'medications', 'medication_routines', 'routine_medications', 'medication_intakes'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anonymous', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
    EXECUTE format('CREATE POLICY application_read ON public.%I FOR SELECT TO authenticated USING ((SELECT application_private.can_read(user_id)))', table_name);
    EXECUTE format('CREATE POLICY application_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT application_private.can_write(user_id)))', table_name);
    EXECUTE format('CREATE POLICY application_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT application_private.can_write(user_id))) WITH CHECK ((SELECT application_private.can_write(user_id)))', table_name);
    EXECUTE format('CREATE POLICY application_delete ON public.%I FOR DELETE TO authenticated USING ((SELECT application_private.can_write(user_id)))', table_name);
  END LOOP;
END;
$policies$;
