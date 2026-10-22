-- Executar após o core e o provisionamento oficial de Neon Auth/Data API.
-- Nenhuma conta antiga é vinculada automaticamente por e-mail.
CREATE TABLE application_private.login_reservations (
  account_id uuid PRIMARY KEY REFERENCES application_private.accounts(id),
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email)))
);
REVOKE ALL ON application_private.login_reservations FROM PUBLIC, authenticated, anonymous;
CREATE UNIQUE INDEX accounts_source_email_lower_idx
  ON application_private.accounts(lower(source_email));

CREATE FUNCTION public.register_application_account()
RETURNS TABLE (user_id uuid, role text, owner_user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, application_private
AS $$
DECLARE subject text := application_private.request_subject();
DECLARE verified_email text;
BEGIN
  IF subject IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  -- Serializa criações concorrentes da mesma identidade.
  PERFORM pg_advisory_xact_lock(hashtextextended(subject, 0));
  IF EXISTS (SELECT FROM application_private.accounts a WHERE a.auth_subject = subject) THEN
    RETURN QUERY SELECT * FROM public.application_context();
    RETURN;
  END IF;
  -- Dados canônicos do serviço de login, sem confiar em parâmetros do cliente.
  SELECT lower(u.email) INTO verified_email FROM neon_auth."user" u
    WHERE u.id::text = subject AND u."emailVerified" AND NOT coalesce(u.banned, false);
  IF verified_email IS NULL OR EXISTS (
    SELECT FROM application_private.accounts a WHERE lower(a.source_email) = verified_email
  ) OR EXISTS (
    SELECT FROM application_private.login_reservations r WHERE r.email = verified_email
  ) THEN
    RAISE EXCEPTION 'Verified new account or administrative migration link required'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO application_private.accounts
    (id, auth_subject, source_email, access_role, created_at, updated_at)
    VALUES (gen_random_uuid(), subject, verified_email, 'owner', now(), now());
  RETURN QUERY SELECT * FROM public.application_context();
END;
$$;
REVOKE ALL ON FUNCTION public.register_application_account() FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.register_application_account() TO authenticated;
