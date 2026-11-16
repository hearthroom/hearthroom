-- Card pins stay on public root comments; blog pinning remains on blog_posts.
ALTER TABLE comments ADD COLUMN pinned_at INTEGER;
ALTER TABLE comments ADD COLUMN pin_notified INTEGER NOT NULL DEFAULT 0;
CREATE INDEX comments_card_pins ON comments(card_id,pinned_at,id) WHERE pinned_at IS NOT NULL;
-- Clearing at the state transition prevents a restored comment reclaiming a slot.
CREATE TRIGGER comments_clear_pin AFTER UPDATE OF status,deleted_at,root_id,parent_id ON comments
WHEN NEW.pinned_at IS NOT NULL AND (NEW.status<>'visible' OR NEW.deleted_at IS NOT NULL OR NEW.root_id IS NOT NULL OR NEW.parent_id IS NOT NULL)
BEGIN UPDATE comments SET pinned_at=NULL WHERE id=NEW.id; END;
