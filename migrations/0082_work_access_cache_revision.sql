-- Candidate caches must see newly public works immediately, including cached
-- empty lists. This clock only invalidates candidates; current Provider checks
-- remain mandatory before returning any cached positive permission.
CREATE TRIGGER managed_discovery_insert AFTER INSERT ON managed_work_access
BEGIN
 UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER managed_discovery_delete AFTER DELETE ON managed_work_access
BEGIN
 UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER managed_discovery_update
AFTER UPDATE OF access,epoch,restriction,approved_role_id,sync_state,sync_operation_id,moderation_revision,confirmed_moderation_revision ON managed_work_access
WHEN OLD.access IS NOT NEW.access OR OLD.epoch IS NOT NEW.epoch
 OR OLD.restriction IS NOT NEW.restriction OR OLD.approved_role_id IS NOT NEW.approved_role_id
 OR OLD.sync_state IS NOT NEW.sync_state OR OLD.sync_operation_id IS NOT NEW.sync_operation_id
 OR OLD.moderation_revision IS NOT NEW.moderation_revision
 OR OLD.confirmed_moderation_revision IS NOT NEW.confirmed_moderation_revision
BEGIN
 UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
END;
