-- Existing automatic policies do not represent the author's v2 opt-in.
ALTER TABLE workshop_policies ADD COLUMN consent_version INTEGER NOT NULL DEFAULT 0;
UPDATE workshop_policies SET allow_new = 0, revision = revision + 1;
