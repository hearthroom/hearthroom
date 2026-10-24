-- Persist the exact consent across unknown seal/prepare outcomes. No bearer or
-- content is retained; retries must not acquire a later author's CAS silently.
ALTER TABLE hosting_versions ADD COLUMN visibility_consent TEXT;
