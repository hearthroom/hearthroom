-- Official identity is assigned only through the authenticated application-admin service.
ALTER TABLE members ADD COLUMN is_official INTEGER NOT NULL DEFAULT 0 CHECK(is_official IN (0,1));
CREATE TABLE official_author_audit (
 request_id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES members(id),
 member_id TEXT NOT NULL REFERENCES members(id),
 official INTEGER NOT NULL CHECK(official IN (0,1)),
 reason TEXT NOT NULL,
 payload TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TRIGGER official_author_revision AFTER UPDATE OF is_official ON members
WHEN OLD.is_official IS NOT NEW.is_official BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.id;
 UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
END;
-- Invalidate snapshots already materialized before this projection existed.
UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
