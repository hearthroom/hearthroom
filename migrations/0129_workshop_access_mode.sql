-- NULL marks legacy rows; only a saved revision > 1 can retain legacy open.
ALTER TABLE workshop_policies ADD COLUMN access_mode TEXT
  CHECK(access_mode IN ('closed', 'self', 'open'));

-- A cancellation can arrive before its local review row. Retain durable proof
-- so a delayed HTTP response cannot recreate that release's review.
CREATE TABLE workshop_cancelled_releases (
 provider TEXT NOT NULL,
 workshop_id TEXT NOT NULL,
 release_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(provider, workshop_id, release_id)
);

CREATE TRIGGER workshop_submission_policy_guard BEFORE INSERT ON workshop_review_submissions
WHEN EXISTS (
 SELECT 1 FROM workshop_cancelled_releases
 WHERE provider=NEW.provider AND workshop_id=NEW.workshop_id AND release_id=NEW.sealed_release_id
) OR NOT (
 COALESCE((
   SELECT CASE
    WHEN p.access_mode IN ('closed','self','open') THEN p.access_mode
    WHEN p.access_mode IS NULL AND p.allow_new=1 AND p.revision>1 THEN 'open'
    ELSE 'closed' END
   FROM workshop_policies p WHERE p.card_id=NEW.card_id AND p.provider=NEW.provider
   ORDER BY p.updated_at DESC LIMIT 1
 ), 'closed') IN (
   'open',
   CASE WHEN NEW.author_num_id=(SELECT author_num_id FROM cards WHERE id=NEW.card_id AND provider=NEW.provider) THEN 'self' ELSE 'open' END
 )
)
BEGIN
 SELECT RAISE(ABORT, 'workshop_policy_closed');
END;
