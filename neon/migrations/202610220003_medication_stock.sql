-- Ampliação aditiva: não altera nem preenche os medicamentos/tomadas existentes.
-- Executar em uma transação pelo executor, após backup e ensaio.
CREATE TABLE application_private.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now(),
  backup_branch_id text NOT NULL,
  backup_snapshot_sha256 text NOT NULL CHECK (backup_snapshot_sha256 ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON application_private.schema_migrations FROM PUBLIC, authenticated, anonymous;
ALTER TABLE application_private.schema_migrations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.medication_stock (
  medication_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  total_tablets integer CHECK (total_tablets >= 0),
  tablets_per_box integer CHECK (tablets_per_box > 0),
  tablets_per_day integer CHECK (tablets_per_day > 0),
  estimated_days numeric GENERATED ALWAYS AS
    (total_tablets::numeric / nullif(tablets_per_day, 0)) STORED,
  full_days_covered integer GENERATED ALWAYS AS
    (total_tablets / nullif(tablets_per_day, 0)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (medication_id, user_id) REFERENCES public.medications(id, user_id)
    ON DELETE CASCADE
);
CREATE INDEX medication_stock_user_id_idx ON public.medication_stock(user_id);

COMMENT ON TABLE public.medication_stock IS
  'Configuração inicial de estoque; saldo declarado, sem consumo automático nesta etapa.';
COMMENT ON COLUMN public.medication_stock.total_tablets IS
  'Total físico atual declarado. NULL significa não informado; zero é estoque esgotado.';
COMMENT ON COLUMN public.medication_stock.tablets_per_box IS
  'Comprimidos por caixa. Não é o número de caixas nem altera o total declarado.';
COMMENT ON COLUMN public.medication_stock.tablets_per_day IS
  'Total de comprimidos por dia explicitamente informado para estimativa simples.';
COMMENT ON COLUMN public.medication_stock.estimated_days IS
  'Total dividido pelo consumo diário; NULL se faltar saldo ou consumo. Não é previsão por agenda.';
COMMENT ON COLUMN public.medication_stock.full_days_covered IS
  'Dias completos cobertos; 10 comprimidos a 3/dia cobrem 3 dias completos.';

CREATE FUNCTION application_private.touch_medication_stock()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION application_private.touch_medication_stock() FROM PUBLIC, authenticated, anonymous;
CREATE TRIGGER medication_stock_updated_at BEFORE UPDATE ON public.medication_stock
  FOR EACH ROW EXECUTE FUNCTION application_private.touch_medication_stock();

ALTER TABLE public.medication_stock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medication_stock FROM PUBLIC, anonymous, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_stock TO authenticated;
CREATE POLICY stock_read ON public.medication_stock FOR SELECT TO authenticated
  USING ((SELECT application_private.can_read(user_id)));
CREATE POLICY stock_insert ON public.medication_stock FOR INSERT TO authenticated
  WITH CHECK ((SELECT application_private.can_write(user_id)));
CREATE POLICY stock_update ON public.medication_stock FOR UPDATE TO authenticated
  USING ((SELECT application_private.can_write(user_id)))
  WITH CHECK ((SELECT application_private.can_write(user_id)));
CREATE POLICY stock_delete ON public.medication_stock FOR DELETE TO authenticated
  USING ((SELECT application_private.can_write(user_id)));

-- INVOKER mantém RLS nas duas tabelas, inclusive no LEFT JOIN dos legados.
CREATE FUNCTION public.medication_stock_summary()
RETURNS TABLE (
  medication_id uuid, user_id uuid, total_tablets integer,
  tablets_per_box integer, tablets_per_day integer,
  estimated_days numeric, full_days_covered integer
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT m.id,m.user_id,s.total_tablets,s.tablets_per_box,s.tablets_per_day,
    s.estimated_days,s.full_days_covered
  FROM public.medications m LEFT JOIN public.medication_stock s
    ON s.medication_id=m.id AND s.user_id=m.user_id;
$$;
REVOKE ALL ON FUNCTION public.medication_stock_summary() FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.medication_stock_summary() TO authenticated;
