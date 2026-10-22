-- Somente após a barreira na origem e comparação da cópia preparada.
CREATE TABLE application_private.cutover_finalization (
  singleton boolean PRIMARY KEY CHECK(singleton),
  source_frozen_at timestamptz NOT NULL,
  snapshot_sha256 text NOT NULL REFERENCES application_private.source_backups,
  finalized_at timestamptz NOT NULL DEFAULT now(),
  deployment_commit text CHECK(deployment_commit ~ '^[0-9a-f]{40}$')
);
REVOKE ALL ON application_private.cutover_finalization FROM PUBLIC, authenticated, anonymous;
ALTER TABLE application_private.cutover_finalization ENABLE ROW LEVEL SECURITY;
