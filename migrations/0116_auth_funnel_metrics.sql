-- Aggregate counters only. No request, account, device or OAuth identifiers.
CREATE TABLE auth_funnel_metrics (
  step TEXT NOT NULL,
  mode TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  code TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (step, mode, locale, country, code)
) WITHOUT ROWID;
