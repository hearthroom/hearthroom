-- Retain the original stamp and decision timestamp; correction is a new event.
CREATE TABLE review_corrections (
 operation_id TEXT PRIMARY KEY,
 submission_id TEXT NOT NULL REFERENCES review_submissions(id),
 actor_member_id TEXT NOT NULL REFERENCES members(id),
 actor_role TEXT NOT NULL,
 note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 2000),
 original_decided_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applying','complete','conflict')),
 command TEXT,
 public_version_id TEXT,
 public_state TEXT CHECK(public_state IN ('previous_version','unpublished','unchanged')),
 completed_at INTEGER
);
CREATE UNIQUE INDEX review_correction_active ON review_corrections(submission_id) WHERE state<>'conflict';
CREATE TRIGGER review_correction_reward_guard BEFORE INSERT ON review_corrections
WHEN EXISTS(SELECT 1 FROM card_rewards r JOIN review_submissions s ON s.card_id=r.card_id
 WHERE s.id=NEW.submission_id AND r.public_days IS NOT NULL
 AND (r.status='pending' OR (r.status='paid' AND r.provider_entry_id IS NULL)))
BEGIN SELECT RAISE(ABORT,'review correction reward pending'); END;
CREATE TRIGGER reward_correction_insert_guard BEFORE INSERT ON card_rewards
WHEN EXISTS(SELECT 1 FROM review_corrections x JOIN review_submissions s ON s.id=x.submission_id
 WHERE s.card_id=NEW.card_id AND x.state IN ('pending','applying'))
 OR (EXISTS(SELECT 1 FROM review_corrections x JOIN review_submissions s ON s.id=x.submission_id
 WHERE s.card_id=NEW.card_id AND x.state='complete') AND NOT EXISTS(
 SELECT 1 FROM cards c WHERE c.id=NEW.card_id AND (c.status='approved' OR c.approved_version_id IS NOT NULL) AND c.public_blocked=0))
BEGIN SELECT RAISE(ABORT,'review correction in progress'); END;
CREATE TRIGGER reward_correction_retry_guard BEFORE UPDATE OF status ON card_rewards
WHEN NEW.status='pending' AND OLD.status<>'pending' AND EXISTS(
 SELECT 1 FROM review_corrections x JOIN review_submissions s ON s.id=x.submission_id
 WHERE s.card_id=NEW.card_id AND x.state IN ('pending','applying'))
 OR (NEW.status='pending' AND OLD.status<>'pending' AND EXISTS(
 SELECT 1 FROM review_corrections x JOIN review_submissions s ON s.id=x.submission_id WHERE s.card_id=NEW.card_id AND x.state='complete')
 AND NOT EXISTS(SELECT 1 FROM cards c WHERE c.id=NEW.card_id AND (c.status='approved' OR c.approved_version_id IS NOT NULL) AND c.public_blocked=0))
BEGIN SELECT RAISE(ABORT,'review correction in progress'); END;
CREATE TRIGGER review_correction_immutable BEFORE UPDATE ON review_corrections
WHEN NEW.operation_id<>OLD.operation_id OR NEW.submission_id<>OLD.submission_id
 OR NEW.actor_member_id<>OLD.actor_member_id OR NEW.actor_role<>OLD.actor_role
 OR NEW.note<>OLD.note OR NEW.created_at<>OLD.created_at OR NEW.original_decided_at<>OLD.original_decided_at
 OR (OLD.command IS NOT NULL AND NEW.command IS NOT OLD.command)
 OR OLD.state IN ('complete','conflict')
BEGIN SELECT RAISE(ABORT,'review correction immutable'); END;

DROP TRIGGER hosting_review_terminal;
CREATE TRIGGER hosting_review_terminal BEFORE UPDATE OF status ON review_submissions
WHEN OLD.status<>'pending' AND NEW.status<>OLD.status AND NOT (
 OLD.status='approved' AND NEW.status='rejected' AND EXISTS(
 SELECT 1 FROM review_corrections x WHERE x.submission_id=OLD.id AND x.state='applying'
 AND x.note=NEW.note AND OLD.decided_at=x.original_decided_at AND NEW.decided_at=OLD.decided_at))
BEGIN SELECT RAISE(ABORT,'submission already decided'); END;


CREATE TRIGGER review_correction_apply_guard BEFORE UPDATE OF state ON review_corrections
WHEN NEW.state='applying' AND (OLD.state<>'pending' OR NOT EXISTS(
 SELECT 1 FROM managed_work_access p WHERE p.work_id=json_extract(NEW.command,'$.workId')
 AND p.epoch>=json_extract(NEW.command,'$.expectedEpoch') AND p.sync_state='changing' AND p.sync_operation_id=NEW.operation_id
 AND EXISTS(SELECT 1 FROM visibility_operations o WHERE o.work_id=p.work_id AND o.operation_id=NEW.operation_id AND o.state='complete')))
BEGIN SELECT RAISE(ABORT,'review correction changed'); END;

CREATE TRIGGER review_correction_command_guard BEFORE UPDATE OF command ON review_corrections
WHEN NEW.command IS NOT NULL AND OLD.command IS NULL AND NOT EXISTS(
 SELECT 1 FROM managed_work_access p WHERE p.work_id=json_extract(NEW.command,'$.workId')
 AND p.epoch=json_extract(NEW.command,'$.expectedEpoch') AND p.sync_state='changing' AND p.sync_operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'review correction changed'); END;

-- Restore an existing publication without announcing a new release.
DROP TRIGGER hosting_decision;
CREATE TRIGGER hosting_decision AFTER UPDATE OF status ON review_submissions
WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE hosting_versions SET state=NEW.status WHERE submission_id=NEW.id;
 UPDATE cards SET
  approved_version_id=(SELECT version_id FROM hosting_versions WHERE submission_id=NEW.id),
  approved_hosted_role_id=(SELECT hosted_revision_id FROM hosting_versions WHERE submission_id=NEW.id),
  rating=NEW.rating,
  rating_descriptors=NEW.rating_descriptors,
  zone=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.zone'),
  names=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.names'),
  summaries=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.summaries'),
  background_url=COALESCE(NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.backgroundUrl'),''),json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.avatarUrl')),
  share_image_url=NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.shareImageUrl'),''),
  landscape_url=NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.backgroundLandscapeUrl'),''),
  tags=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.tags')
 WHERE id=NEW.card_id AND NEW.status='approved';
 UPDATE cards SET status='approved' WHERE id=NEW.card_id AND approved_version_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=cards.provider AND p.source_role_id=cards.source_role_id AND (p.access<>'public' OR p.sync_state<>'complete'));
 UPDATE cards SET status='unshared' WHERE id=NEW.card_id AND approved_version_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=cards.provider AND p.source_role_id=cards.source_role_id AND (p.access<>'public' OR p.sync_state<>'complete'));
END;

-- Restore an existing publication without announcing a new release.
DROP TRIGGER community_publication_update;
CREATE TRIGGER community_publication_update AFTER UPDATE OF status ON cards
WHEN NOT EXISTS(SELECT 1 FROM review_corrections x WHERE x.submission_id IN (SELECT id FROM review_submissions WHERE card_id=NEW.id) AND x.state='applying') AND NEW.status='approved' AND NEW.public_blocked=0 AND NEW.board_hidden=0
 AND (OLD.status='pending' OR (OLD.status='unshared' AND NEW.approved_version_id IS OLD.last_public_version_id))
BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id,actor_id,card_id,extra)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/cards/'||NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id,o.member_id,NEW.id,json_object('event','new')
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id WHERE o.card_id=NEW.id
 AND NOT EXISTS(SELECT 1 FROM community_preferences p WHERE p.member_id=f.member_id AND p.notifications=0)
 AND NOT EXISTS(SELECT 1 FROM moderation_state s WHERE s.provider=NEW.provider AND s.source_role_id=NEW.source_role_id AND (s.public_blocked=1 OR s.board_hidden=1));
END;

-- Restore an existing publication without announcing a new release.
DROP TRIGGER card_update_publication_guard;
CREATE TRIGGER card_update_publication_guard BEFORE UPDATE OF status,approved_version_id ON cards
WHEN NOT EXISTS(SELECT 1 FROM review_corrections x WHERE x.submission_id IN (SELECT id FROM review_submissions WHERE card_id=NEW.id) AND x.state='applying') AND NEW.status='approved' AND NEW.approved_version_id IS NOT OLD.last_public_version_id
 AND EXISTS(SELECT 1 FROM hosting_versions WHERE version_id=NEW.approved_version_id AND update_kind='major')
 AND NOT EXISTS(SELECT 1 FROM card_update_events WHERE version_id=NEW.approved_version_id)
BEGIN SELECT RAISE(ABORT,'update_notification_not_reserved'); END;

-- Restore an existing publication without announcing a new release.
DROP TRIGGER card_update_publication;
CREATE TRIGGER card_update_publication AFTER UPDATE OF status,approved_version_id ON cards
WHEN NOT EXISTS(SELECT 1 FROM review_corrections x WHERE x.submission_id IN (SELECT id FROM review_submissions WHERE card_id=NEW.id) AND x.state='applying') AND NEW.status='approved' AND NEW.approved_version_id IS NOT OLD.last_public_version_id
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
