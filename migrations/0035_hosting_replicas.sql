-- One issuer version can be hosted on either provider. Preserve review guards.
DROP TRIGGER hosting_decision;
DROP TRIGGER hosting_review_search;
DROP TRIGGER hosting_review_superseded;
DROP TRIGGER hosting_review_terminal;
DROP TRIGGER hosting_snapshot_immutable;
DROP TRIGGER hosting_stamp_pending;
DROP TRIGGER hosting_submission_guard;
DROP TRIGGER moderation_decision;
DROP TRIGGER moderation_suspend;
CREATE TABLE hosting_versions_next (
 version_id TEXT PRIMARY KEY,
 work_id TEXT NOT NULL,
 member_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 source_role_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('harbor','lunatalk')),
 nsfw INTEGER NOT NULL,
 hosted_revision_id TEXT,
 card_id TEXT,
 submission_id TEXT UNIQUE,
 public_role TEXT,
 state TEXT NOT NULL DEFAULT 'preparing',
 created_at INTEGER NOT NULL,
 UNIQUE(member_id,operation_id)
);
INSERT INTO hosting_versions_next SELECT * FROM hosting_versions;
DROP TABLE hosting_versions;
ALTER TABLE hosting_versions_next RENAME TO hosting_versions;
CREATE UNIQUE INDEX hosting_one_submission ON hosting_versions(work_id) WHERE state='preparing';
CREATE TRIGGER hosting_decision AFTER UPDATE OF status ON review_submissions
WHEN NEW.status IN ('approved','rejected') AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE hosting_versions SET state=NEW.status WHERE submission_id=NEW.id;
 UPDATE cards SET status='approved'
 WHERE id=NEW.card_id AND approved_version_id IS NOT NULL;
 UPDATE cards SET
  approved_version_id=(SELECT version_id FROM hosting_versions WHERE submission_id=NEW.id),
  approved_hosted_role_id=(SELECT hosted_revision_id FROM hosting_versions WHERE submission_id=NEW.id),
  nsfw=NEW.nsfw,
  zone=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.zone'),
  names=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.names'),
  summaries=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.summaries'),
  avatar_url=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.avatarUrl'),
  background_url=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.backgroundUrl'),
  tags=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.tags')
 WHERE id=NEW.card_id AND NEW.status='approved';
END;
CREATE TRIGGER hosting_review_search AFTER UPDATE OF status ON review_submissions
WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE cards SET
  search_text=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchText'),search_text),
  slug=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.slug')
 WHERE id=NEW.card_id;
END;
CREATE TRIGGER hosting_review_superseded AFTER UPDATE OF status ON review_submissions
WHEN NEW.status='superseded' AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE hosting_versions SET state='superseded' WHERE submission_id=NEW.id;
END;
CREATE TRIGGER hosting_review_terminal BEFORE UPDATE OF status ON review_submissions
WHEN OLD.status<>'pending' AND NEW.status<>OLD.status
BEGIN SELECT RAISE(ABORT,'submission already decided'); END;
CREATE TRIGGER hosting_snapshot_immutable BEFORE UPDATE ON review_snapshots
WHEN EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=OLD.submission_id)
BEGIN SELECT RAISE(ABORT,'hosted_revision_immutable'); END;
CREATE TRIGGER hosting_stamp_pending BEFORE INSERT ON review_stamps
WHEN EXISTS(SELECT 1 FROM review_submissions s WHERE s.id=NEW.submission_id AND s.status<>'pending')
BEGIN SELECT RAISE(ABORT,'submission already decided'); END;
CREATE TRIGGER hosting_submission_guard BEFORE UPDATE OF submission_id ON hosting_versions
WHEN NEW.submission_id IS NOT NULL AND OLD.submission_id IS NULL AND (
 OLD.state<>'preparing' OR EXISTS(
  SELECT 1 FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id
  WHERE v.work_id=NEW.work_id AND s.status='pending'
 )
)
-- Remote D1 splits CASE ... END inside triggers; keep the predicate in WHEN.
BEGIN
 SELECT RAISE(ABORT,'submission_pending');
END;
CREATE TRIGGER moderation_decision AFTER UPDATE OF status ON moderation_cases WHEN NEW.status='confirmed'
BEGIN
 INSERT OR IGNORE INTO moderation_blocked_versions SELECT v.version_id,NEW.id FROM hosting_versions v JOIN cards c ON c.id=v.card_id WHERE NEW.action='restore_public' AND c.provider=NEW.provider AND c.source_role_id=NEW.source_role_id AND v.state='approved' AND v.version_id<>NEW.version_id;
 DELETE FROM moderation_blocked_versions WHERE version_id=NEW.version_id AND NEW.action='restore_public';
 UPDATE moderation_state SET board_hidden=1 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id AND NEW.action='delist';
 UPDATE moderation_state SET board_hidden=0 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id AND NEW.action='restore_listing';
 UPDATE moderation_state SET public_blocked=0 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id AND NEW.action='restore_public';
END;
CREATE TRIGGER moderation_suspend AFTER INSERT ON moderation_cases WHEN NEW.action='suspend'
BEGIN
 INSERT OR IGNORE INTO moderation_blocked_versions SELECT v.version_id,NEW.id FROM hosting_versions v JOIN cards c ON c.id=v.card_id WHERE c.provider=NEW.provider AND c.source_role_id=NEW.source_role_id AND v.state='approved';
 UPDATE moderation_state SET public_blocked=1 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id;
END;

-- Provider role locators are not version identities. Keep old receipts for links
-- and existing conversations after a newer version becomes current.
CREATE TABLE hosting_replicas (
 version_id TEXT NOT NULL REFERENCES hosting_versions(version_id),
 provider TEXT NOT NULL CHECK(provider IN ('harbor','lunatalk')),
 source_role_id TEXT NOT NULL,
 hosted_revision_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('ready','failed')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(version_id,provider),
 UNIQUE(provider,hosted_revision_id)
);
INSERT INTO hosting_replicas SELECT version_id,provider,source_role_id,hosted_revision_id,'ready',created_at
 FROM hosting_versions WHERE hosted_revision_id IS NOT NULL;

-- No tokens/private content are retained in transfer receipts.
CREATE TABLE hosting_transfers (
 version_id TEXT NOT NULL REFERENCES hosting_versions(version_id),
 provider TEXT NOT NULL,
 external_id INTEGER NOT NULL,
 operation_id TEXT NOT NULL,
 draft_role_id TEXT,
 hosted_revision_id TEXT,
 progress TEXT NOT NULL DEFAULT '{"books":{}}',
 state TEXT NOT NULL DEFAULT 'pending',
 error TEXT NOT NULL DEFAULT '',
 lease TEXT,
 locked_until INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(version_id,provider)
);
