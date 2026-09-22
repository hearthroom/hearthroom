-- Contract phase: run only after the portrait-only Worker is live and older
-- requests have drained. The phase 1 Worker is the compatible rollback target.
ALTER TABLE cards DROP COLUMN avatar_url;
