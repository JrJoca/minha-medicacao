-- Executado SOMENTE pelo preparador de corte, após a cópia validada.
-- O backup completo inclui contas/hashes antigos; nunca expor este esquema.
CREATE TABLE application_private.source_backups (
  snapshot_sha256 text PRIMARY KEY,
  source_project text NOT NULL,
  exported_at timestamptz NOT NULL,
  counts jsonb NOT NULL,
  snapshot_bytes bytea NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  CHECK (encode(sha256(snapshot_bytes),'hex') = snapshot_sha256)
);
CREATE TABLE application_private.cutover_control (
  singleton boolean PRIMARY KEY CHECK(singleton),
  phase text NOT NULL CHECK (phase IN ('prepared','active')),
  snapshot_sha256 text NOT NULL REFERENCES application_private.source_backups,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);
REVOKE ALL ON application_private.source_backups, application_private.cutover_control
  FROM PUBLIC, authenticated, anonymous;
ALTER TABLE application_private.source_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_private.cutover_control ENABLE ROW LEVEL SECURITY;
