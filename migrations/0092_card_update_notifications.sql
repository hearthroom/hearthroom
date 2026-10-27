ALTER TABLE hosting_versions ADD COLUMN update_kind TEXT NOT NULL DEFAULT 'minor' CHECK(update_kind IN ('minor','major'));
ALTER TABLE hosting_versions ADD COLUMN update_note TEXT NOT NULL DEFAULT '';
ALTER TABLE hosting_versions ADD COLUMN published_at INTEGER;
-- Remember the last public pointer across a temporary withdrawal. A new silent
-- revision must not masquerade as the existing "restored public" notification.
ALTER TABLE cards ADD COLUMN last_public_version_id TEXT;
UPDATE cards SET last_public_version_id=approved_version_id;

CREATE TABLE card_update_events (
 version_id TEXT PRIMARY KEY REFERENCES hosting_versions(version_id) ON DELETE CASCADE,
 work_id TEXT NOT NULL REFERENCES works(id),
 state TEXT NOT NULL CHECK(state IN ('reserved','published')),
 reserved_at INTEGER NOT NULL,
 published_at INTEGER
);
CREATE UNIQUE INDEX card_update_one_reservation ON card_update_events(work_id) WHERE state='reserved';
CREATE INDEX card_update_latest ON card_update_events(work_id,published_at);
CREATE TRIGGER card_update_reservation_guard BEFORE INSERT ON card_update_events
WHEN EXISTS(SELECT 1 FROM card_update_events WHERE work_id=NEW.work_id AND state='published' AND published_at+604800000>NEW.reserved_at)
BEGIN SELECT RAISE(ABORT,'update_notification_cooldown'); END;
CREATE TRIGGER card_update_intent_immutable BEFORE UPDATE OF update_kind,update_note ON hosting_versions
WHEN OLD.update_kind<>NEW.update_kind OR OLD.update_note<>NEW.update_note
BEGIN SELECT RAISE(ABORT,'hosting_operation_conflict'); END;
CREATE TRIGGER card_update_cancel AFTER UPDATE OF status ON review_submissions
WHEN NEW.status IN ('rejected','superseded')
BEGIN
 DELETE FROM card_update_events WHERE state='reserved' AND version_id IN(SELECT version_id FROM hosting_versions WHERE submission_id=NEW.id);
END;

DROP TRIGGER community_publication_update;
-- Initial publication and restoration keep their existing semantics; content
-- updates have a separate explicit consent, frozen note and durable event.
CREATE TRIGGER community_publication_update AFTER UPDATE OF status ON cards
WHEN NEW.status='approved' AND NEW.public_blocked=0 AND NEW.board_hidden=0
 AND (OLD.status='pending' OR (OLD.status='unshared' AND NEW.approved_version_id IS OLD.last_public_version_id))
BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id,actor_id,card_id,extra)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/cards/'||NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id,o.member_id,NEW.id,json_object('event','new')
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id WHERE o.card_id=NEW.id
 AND NOT EXISTS(SELECT 1 FROM community_preferences p WHERE p.member_id=f.member_id AND p.notifications=0)
 AND NOT EXISTS(SELECT 1 FROM moderation_state s WHERE s.provider=NEW.provider AND s.source_role_id=NEW.source_role_id AND (s.public_blocked=1 OR s.board_hidden=1));
END;

CREATE TRIGGER card_update_publication_guard BEFORE UPDATE OF status,approved_version_id ON cards
WHEN NEW.status='approved' AND NEW.approved_version_id IS NOT OLD.last_public_version_id
 AND EXISTS(SELECT 1 FROM hosting_versions WHERE version_id=NEW.approved_version_id AND update_kind='major')
 AND NOT EXISTS(SELECT 1 FROM card_update_events WHERE version_id=NEW.approved_version_id)
BEGIN SELECT RAISE(ABORT,'update_notification_not_reserved'); END;

CREATE TRIGGER card_update_publication AFTER UPDATE OF status,approved_version_id ON cards
WHEN NEW.status='approved' AND NEW.approved_version_id IS NOT OLD.last_public_version_id
BEGIN
 UPDATE card_update_events SET state='published',published_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE version_id=NEW.approved_version_id AND state='reserved';
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id,actor_id,card_id,extra)
 SELECT 'update:'||v.version_id||':'||m.id,m.id,'followed_work','/cards/'||NEW.id||'?version='||v.version_id,e.published_at,o.member_id,o.member_id,NEW.id,
 json_object('event','update','note',v.update_note,'version',v.version_id)
 FROM hosting_versions v JOIN card_update_events e ON e.version_id=v.version_id
 JOIN community_card_owners o ON o.card_id=NEW.id JOIN members m ON m.id<>o.member_id AND m.id IN(
   SELECT member_id FROM member_follows WHERE author_id=o.member_id
   UNION SELECT member_id FROM member_favorites WHERE card_id=NEW.id)
 WHERE v.version_id=NEW.approved_version_id AND e.state='published'
 AND NOT EXISTS(SELECT 1 FROM community_preferences p WHERE p.member_id=m.id AND p.notifications=0)
 AND NEW.public_blocked=0 AND NEW.board_hidden=0
 AND NOT EXISTS(SELECT 1 FROM moderation_state s WHERE s.provider=NEW.provider AND s.source_role_id=NEW.source_role_id AND (s.public_blocked=1 OR s.board_hidden=1));
 INSERT INTO ops_metrics(metric,operation,outcome,value)
 SELECT 'card_update','publish',CASE WHEN v.update_kind='major' THEN 'queued' ELSE 'minor' END,1
 FROM hosting_versions v WHERE v.version_id=NEW.approved_version_id
 ON CONFLICT(metric,operation,outcome) DO UPDATE SET value=value+1;
 UPDATE hosting_versions SET published_at=COALESCE(published_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) WHERE version_id=NEW.approved_version_id;
 UPDATE cards SET last_public_version_id=NEW.approved_version_id WHERE id=NEW.id;
END;
