CREATE TABLE public_aggregate_proof (
  scope TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0,
  lease TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT NOT NULL DEFAULT '',
  failed_until INTEGER NOT NULL DEFAULT 0
);
