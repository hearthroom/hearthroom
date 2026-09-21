-- Rank/counter changes may wait five minutes; visibility changes must invalidate
-- every internal cache tier immediately using the authoritative D1 revision.
CREATE TRIGGER board_cache_visibility AFTER UPDATE OF status, nsfw, approved_version_id ON cards
WHEN NEW.status IS NOT OLD.status OR NEW.nsfw IS NOT OLD.nsfw
  OR NEW.approved_version_id IS NOT OLD.approved_version_id
BEGIN
  UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER board_cache_delete AFTER DELETE ON cards
BEGIN
  UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
END;
