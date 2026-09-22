-- Replace community card UUIDs with their permanent public numbers.
-- Provider locators and non-card identities retain their external contracts.
-- Run atomically: D1 migrations supply the transaction. Deferred FKs do not
-- disable CASCADE, so favorites are copied without FKs before replacing cards.
PRAGMA defer_foreign_keys = ON;

DROP TRIGGER cards_fts_ai;

DROP TRIGGER cards_fts_ad;

DROP TRIGGER cards_fts_au;

DROP TRIGGER hosting_review_immutable;

DROP TRIGGER moderation_vote_guard;

DROP TRIGGER moderation_projection;

DROP TRIGGER moderation_registration;

DROP TRIGGER moderation_tag_projection;

DROP TRIGGER moderation_restore_superseded;

DROP TRIGGER moderation_restore_version_guard;

DROP VIEW community_card_owners;

DROP TRIGGER community_review_queue;

DROP TRIGGER community_review_result;

DROP TRIGGER community_comment_reply;

DROP TRIGGER community_publication_insert;

DROP TRIGGER community_publication_update;

DROP TRIGGER board_cache_visibility;

DROP TRIGGER board_cache_delete;

DROP TRIGGER snapshot_comments_insert;

DROP TRIGGER snapshot_comments_update;

DROP TRIGGER snapshot_comments_delete;

DROP TRIGGER review_delivery_insert;

DROP TRIGGER review_delivery_update;

DROP TRIGGER review_delivery_card;

DROP TRIGGER review_delivery_card_delete;

DROP TRIGGER review_stamp_claim_guard;

DROP TRIGGER hosting_decision;

DROP TRIGGER hosting_review_search;

DROP TRIGGER hosting_review_superseded;

DROP TRIGGER hosting_review_terminal;

DROP TRIGGER hosting_snapshot_immutable;

DROP TRIGGER hosting_stamp_pending;

DROP TRIGGER hosting_submission_guard;

DROP TRIGGER moderation_decision;

DROP TRIGGER moderation_suspend;

INSERT OR IGNORE INTO card_numbers(provider,source_role_id)
SELECT provider,source_role_id FROM cards
UNION SELECT provider,source_role_id FROM review_submissions
UNION SELECT provider,source_role_id FROM hosting_versions
UNION SELECT source_provider,source_role_id FROM works;
CREATE TABLE card_identity_migration (old_id TEXT PRIMARY KEY, num INTEGER NOT NULL);
INSERT INTO card_identity_migration
SELECT c.id,n.num FROM cards c JOIN card_numbers n USING(provider,source_role_id)
UNION SELECT s.card_id,n.num FROM review_submissions s JOIN card_numbers n USING(provider,source_role_id)
UNION SELECT v.card_id,n.num FROM hosting_versions v JOIN card_numbers n USING(provider,source_role_id) WHERE v.card_id IS NOT NULL;
-- Unknown historical references abort the transaction rather than discard data.
CREATE TABLE card_identity_migration_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO card_identity_migration_guard SELECT NOT EXISTS (
 SELECT card_id FROM comments WHERE card_id NOT IN (SELECT old_id FROM card_identity_migration)
 UNION ALL SELECT card_id FROM member_favorites WHERE card_id NOT IN (SELECT old_id FROM card_identity_migration)
);
CREATE TABLE card_favorites_migration AS SELECT * FROM member_favorites;
DROP TABLE member_favorites;

CREATE TABLE cards_numeric (
  id INTEGER    PRIMARY KEY CHECK(id>100000),
  source_role_id TEXT    NOT NULL,
  author_num_id  INTEGER NOT NULL,
  author_name    TEXT    NOT NULL DEFAULT '',
  author_avatar  TEXT    NOT NULL DEFAULT '',
  names          TEXT    NOT NULL DEFAULT '{}',
  summaries      TEXT    NOT NULL DEFAULT '{}',
  avatar_url     TEXT,
  background_url TEXT,
  slug           TEXT,
  tags           TEXT    NOT NULL DEFAULT '[]',
  talk_num       INTEGER NOT NULL DEFAULT 0,
  follow_num     INTEGER NOT NULL DEFAULT 0,
  talk_num_prev  INTEGER NOT NULL DEFAULT 0,
  hot_score      INTEGER GENERATED ALWAYS AS (talk_num - talk_num_prev) STORED,
  search_text    TEXT    NOT NULL DEFAULT '',
  registered_at  INTEGER NOT NULL,
  last_synced_at INTEGER NOT NULL,
  zone           TEXT    NOT NULL DEFAULT 'all',
  provider       TEXT    NOT NULL DEFAULT 'lunatalk',
  status         TEXT    NOT NULL DEFAULT 'approved',
  reviewed_hash  TEXT    NOT NULL DEFAULT '',
  nsfw           INTEGER NOT NULL DEFAULT 0
, approved_version_id TEXT, approved_hosted_role_id TEXT, board_hidden INTEGER NOT NULL DEFAULT 0, public_blocked INTEGER NOT NULL DEFAULT 0, comment_revision TEXT NOT NULL DEFAULT '', featured_at INTEGER);

INSERT INTO cards_numeric (id, source_role_id, author_num_id, author_name, author_avatar, names, summaries, avatar_url, background_url, slug, tags, talk_num, follow_num, talk_num_prev, search_text, registered_at, last_synced_at, zone, provider, status, reviewed_hash, nsfw, approved_version_id, approved_hosted_role_id, board_hidden, public_blocked, comment_revision, featured_at)
SELECT (SELECT num FROM card_identity_migration WHERE old_id=src.id), src.source_role_id, src.author_num_id, src.author_name, src.author_avatar, src.names, src.summaries, src.avatar_url, src.background_url, src.slug, src.tags, src.talk_num, src.follow_num, src.talk_num_prev, src.search_text, src.registered_at, src.last_synced_at, src.zone, src.provider, src.status, src.reviewed_hash, src.nsfw, src.approved_version_id, src.approved_hosted_role_id, src.board_hidden, src.public_blocked, src.comment_revision, src.featured_at FROM cards src;

DROP TABLE cards;

ALTER TABLE cards_numeric RENAME TO cards;

CREATE INDEX idx_cards_registered ON cards (registered_at DESC);

CREATE INDEX idx_cards_talk       ON cards (talk_num DESC, follow_num DESC);

CREATE INDEX idx_cards_hot        ON cards (hot_score DESC, registered_at DESC);

CREATE INDEX idx_cards_author     ON cards (author_num_id, registered_at DESC);

CREATE INDEX idx_cards_sync_cursor ON cards (last_synced_at);

CREATE INDEX idx_cards_zone_hot   ON cards (zone, hot_score DESC, registered_at DESC);

CREATE INDEX idx_cards_zone_new   ON cards (zone, registered_at DESC);

CREATE INDEX idx_cards_zone_talk  ON cards (zone, talk_num DESC, follow_num DESC);

CREATE INDEX idx_cards_status     ON cards (status);

CREATE UNIQUE INDEX uniq_cards_provider_role ON cards (provider, source_role_id);

CREATE INDEX idx_cards_provider_zone ON cards (provider, zone, registered_at DESC);

CREATE INDEX cards_featured ON cards (featured_at) WHERE featured_at IS NOT NULL;

CREATE TABLE comments_numeric (
  id            TEXT    PRIMARY KEY,
  card_id INTEGER    NOT NULL,
  member_id     TEXT    NOT NULL,
  parent_id     TEXT,
  root_id       TEXT,
  content       TEXT    NOT NULL,
  reply_to_name TEXT    NOT NULL DEFAULT '',
  like_count    INTEGER NOT NULL DEFAULT 0,
  reply_count   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);

INSERT INTO comments_numeric (id, card_id, member_id, parent_id, root_id, content, reply_to_name, like_count, reply_count, created_at, deleted_at)
SELECT src.id, (SELECT num FROM card_identity_migration WHERE old_id=src.card_id), src.member_id, src.parent_id, src.root_id, src.content, src.reply_to_name, src.like_count, src.reply_count, src.created_at, src.deleted_at FROM comments src;

DROP TABLE comments;

ALTER TABLE comments_numeric RENAME TO comments;

CREATE INDEX idx_comments_card_top ON comments (card_id, created_at DESC) WHERE root_id IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_comments_root ON comments (root_id, created_at) WHERE deleted_at IS NULL;

CREATE INDEX idx_comments_member_time ON comments (member_id, created_at);

CREATE TABLE review_submissions_numeric (
  id             TEXT    PRIMARY KEY,
  card_id INTEGER    NOT NULL,
  provider       TEXT    NOT NULL,
  source_role_id TEXT    NOT NULL,
  kind           TEXT    NOT NULL,
  status         TEXT    NOT NULL,
  content_hash   TEXT    NOT NULL DEFAULT '',
  submitted_at   INTEGER NOT NULL,
  claimed_by     TEXT,
  claimed_at     INTEGER,
  decided_at     INTEGER,
  note           TEXT    NOT NULL DEFAULT ''
, nsfw INTEGER NOT NULL DEFAULT 0, claim_generation TEXT NOT NULL DEFAULT '');

INSERT INTO review_submissions_numeric (id, card_id, provider, source_role_id, kind, status, content_hash, submitted_at, claimed_by, claimed_at, decided_at, note, nsfw, claim_generation)
SELECT src.id, (SELECT num FROM card_identity_migration WHERE old_id=src.card_id), src.provider, src.source_role_id, src.kind, src.status, src.content_hash, src.submitted_at, src.claimed_by, src.claimed_at, src.decided_at, src.note, src.nsfw, src.claim_generation FROM review_submissions src;

DROP TABLE review_submissions;

ALTER TABLE review_submissions_numeric RENAME TO review_submissions;

CREATE INDEX idx_submissions_status_time ON review_submissions (status, submitted_at);

CREATE INDEX idx_submissions_card ON review_submissions (card_id);

CREATE TABLE hosting_versions_numeric (
 version_id TEXT PRIMARY KEY,
 work_id TEXT NOT NULL,
 member_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 source_role_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('harbor','lunatalk')),
 nsfw INTEGER NOT NULL,
 hosted_revision_id TEXT,
 card_id INTEGER,
 submission_id TEXT UNIQUE,
 public_role TEXT,
 state TEXT NOT NULL DEFAULT 'preparing',
 created_at INTEGER NOT NULL,
 UNIQUE(member_id,operation_id)
);

INSERT INTO hosting_versions_numeric (version_id, work_id, member_id, operation_id, source_role_id, provider, nsfw, hosted_revision_id, card_id, submission_id, public_role, state, created_at)
SELECT src.version_id, src.work_id, src.member_id, src.operation_id, src.source_role_id, src.provider, src.nsfw, src.hosted_revision_id, (SELECT num FROM card_identity_migration WHERE old_id=src.card_id), src.submission_id, src.public_role, src.state, src.created_at FROM hosting_versions src;

DROP TABLE hosting_versions;

ALTER TABLE hosting_versions_numeric RENAME TO hosting_versions;

CREATE UNIQUE INDEX hosting_one_submission ON hosting_versions(work_id) WHERE state='preparing';

CREATE TABLE member_favorites_numeric (
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(member_id, card_id)
);

INSERT INTO member_favorites_numeric (member_id, card_id, created_at)
SELECT src.member_id, (SELECT num FROM card_identity_migration WHERE old_id=src.card_id), src.created_at FROM card_favorites_migration src;

ALTER TABLE member_favorites_numeric RENAME TO member_favorites;

CREATE INDEX member_favorites_recent ON member_favorites(member_id, created_at DESC);

CREATE INDEX member_favorites_card ON member_favorites(card_id);

-- Notifications embed card URLs, so migrate their durable destinations too.
UPDATE community_notifications SET path='/cards/'||(SELECT num FROM card_identity_migration WHERE old_id=substr(path,8))
WHERE path LIKE '/cards/%' AND substr(path,8) IN (SELECT old_id FROM card_identity_migration);
DELETE FROM cards_fts;
INSERT INTO cards_fts(rowid,search_text) SELECT id,search_text FROM cards;
UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
DROP TABLE card_favorites_migration;
DROP TABLE card_identity_migration_guard;
DROP TABLE card_identity_migration;

CREATE VIEW community_card_owners AS
 SELECT c.id AS card_id, COALESCE(mc.owner_member_id,mi.member_id) AS member_id,
 COALESCE(wc.work_id,w.id,c.provider||':'||c.source_role_id) AS work_id
 FROM cards c LEFT JOIN member_identities mi ON mi.provider=c.provider AND mi.external_id=CAST(c.author_num_id AS TEXT)
 LEFT JOIN member_connections mc ON mc.provider=c.provider AND mc.external_id=CAST(c.author_num_id AS TEXT)
 LEFT JOIN work_copies wc ON wc.provider=c.provider AND wc.role_id=c.source_role_id
 LEFT JOIN works w ON w.source_provider=c.provider AND w.source_role_id=c.source_role_id;

CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
END;

CREATE TRIGGER cards_fts_au AFTER UPDATE OF search_text ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO cards_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER hosting_review_immutable BEFORE UPDATE ON review_submissions
WHEN OLD.content_hash LIKE 'version:%' AND (
 NEW.content_hash<>OLD.content_hash OR NEW.nsfw<>OLD.nsfw OR
 NEW.card_id<>OLD.card_id OR NEW.source_role_id<>OLD.source_role_id OR NEW.kind<>OLD.kind
)
BEGIN SELECT RAISE(ABORT,'hosted_revision_immutable'); END;

CREATE TRIGGER moderation_vote_guard BEFORE INSERT ON moderation_votes
WHEN NOT EXISTS(SELECT 1 FROM moderation_cases k WHERE k.id=NEW.case_id AND k.status='pending' AND k.author_member_id<>NEW.member_id)
 OR EXISTS(SELECT 1 FROM moderation_cases k WHERE k.id=NEW.case_id AND k.action='restore_public' AND NOT EXISTS(SELECT 1 FROM cards c WHERE c.provider=k.provider AND c.source_role_id=k.source_role_id AND COALESCE(c.approved_version_id,c.reviewed_hash)=k.version_id))
 OR NOT EXISTS(SELECT 1 FROM reviewers WHERE member_id=NEW.member_id AND revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT,'moderation_conflict'); END;

CREATE TRIGGER moderation_projection AFTER UPDATE ON moderation_state
BEGIN
 UPDATE cards SET board_hidden=NEW.board_hidden,public_blocked=NEW.public_blocked,tags=COALESCE(NEW.tags_override,tags)
 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id;
 UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER moderation_registration AFTER INSERT ON cards
BEGIN
 UPDATE cards SET board_hidden=COALESCE((SELECT board_hidden FROM moderation_state WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id),0),
 public_blocked=COALESCE((SELECT public_blocked FROM moderation_state WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id),0),
 tags=COALESCE((SELECT tags_override FROM moderation_state WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id),tags)
 WHERE id=NEW.id;
END;

CREATE TRIGGER moderation_tag_projection AFTER UPDATE OF tags ON cards
WHEN EXISTS(SELECT 1 FROM moderation_state WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id AND tags_override IS NOT NULL AND tags_override<>NEW.tags)
BEGIN
 UPDATE cards SET tags=(SELECT tags_override FROM moderation_state WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id) WHERE id=NEW.id;
END;

CREATE TRIGGER moderation_restore_superseded AFTER UPDATE OF approved_version_id ON cards
WHEN NEW.approved_version_id IS NOT OLD.approved_version_id
BEGIN
 UPDATE moderation_cases SET status='dismissed',decided_at=CAST(strftime('%s','now') AS INTEGER)*1000,resolution='moderation.resolution.versionChanged'
 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id AND action='restore_public' AND status IN ('pending','disputed');
END;

CREATE TRIGGER moderation_restore_version_guard BEFORE UPDATE OF status ON moderation_cases
WHEN NEW.action='restore_public' AND NEW.status='confirmed' AND NOT EXISTS(
 SELECT 1 FROM cards c WHERE c.provider=NEW.provider AND c.source_role_id=NEW.source_role_id AND COALESCE(c.approved_version_id,c.reviewed_hash)=NEW.version_id)
BEGIN SELECT RAISE(ABORT,'moderation_conflict'); END;

CREATE TRIGGER community_review_queue AFTER INSERT ON review_submissions WHEN NEW.status='pending' BEGIN
 INSERT INTO community_review_signal VALUES(1,lower(hex(randomblob(16))),0)
 ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,delivered=0;
END;

CREATE TRIGGER community_review_result AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') BEGIN
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
 SELECT o.member_id,'first_work',o.work_id,NEW.decided_at FROM community_card_owners o
 WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL AND NEW.status='approved';
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at)
 SELECT 'review:'||NEW.id,o.member_id,'review_result','/mine',NEW.decided_at FROM community_card_owners o
 JOIN community_preferences p ON p.member_id=o.member_id AND p.notifications=1 WHERE o.card_id=NEW.card_id;

END;

CREATE TRIGGER community_comment_reply AFTER INSERT ON comments WHEN NEW.parent_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at)
 SELECT 'comment:'||NEW.id,c.member_id,'comment_reply','/cards/'||NEW.card_id,NEW.created_at FROM comments c
 JOIN community_preferences p ON p.member_id=c.member_id AND p.notifications=1
 WHERE c.id=NEW.parent_id AND c.member_id<>NEW.member_id;
END;

CREATE TRIGGER community_publication_insert AFTER INSERT ON cards WHEN NEW.status='approved' AND NEW.public_blocked=0 AND NEW.board_hidden=0 BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/library',CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id
 JOIN community_preferences p ON p.member_id=f.member_id AND p.notifications=1 WHERE o.card_id=NEW.id
 AND NOT EXISTS (SELECT 1 FROM moderation_state s WHERE s.provider=NEW.provider AND s.source_role_id=NEW.source_role_id AND (s.public_blocked=1 OR s.board_hidden=1));
END;

CREATE TRIGGER community_publication_update AFTER UPDATE OF status,reviewed_hash,approved_version_id,names,summaries ON cards
 WHEN NEW.status='approved' AND NEW.public_blocked=0 AND NEW.board_hidden=0 AND (OLD.status<>'approved' OR NEW.reviewed_hash<>OLD.reviewed_hash
 OR COALESCE(NEW.approved_version_id,'')<>COALESCE(OLD.approved_version_id,'') OR NEW.names<>OLD.names OR NEW.summaries<>OLD.summaries) BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/library',CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id
 JOIN community_preferences p ON p.member_id=f.member_id AND p.notifications=1 WHERE o.card_id=NEW.id
 AND NOT EXISTS (SELECT 1 FROM moderation_state s WHERE s.provider=NEW.provider AND s.source_role_id=NEW.source_role_id AND (s.public_blocked=1 OR s.board_hidden=1));
END;

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

CREATE TRIGGER snapshot_comments_insert AFTER INSERT ON comments BEGIN
 UPDATE cards SET comment_revision=lower(hex(randomblob(16))) WHERE id=NEW.card_id;
END;

CREATE TRIGGER snapshot_comments_update AFTER UPDATE ON comments BEGIN
 UPDATE cards SET comment_revision=lower(hex(randomblob(16))) WHERE id=NEW.card_id;
END;

CREATE TRIGGER snapshot_comments_delete AFTER DELETE ON comments BEGIN
 UPDATE cards SET comment_revision=lower(hex(randomblob(16))) WHERE id=OLD.card_id;
END;

CREATE TRIGGER review_delivery_insert AFTER INSERT ON review_submissions BEGIN
 INSERT INTO review_deliveries(id,kind,submission_id,updated_at) VALUES('review:'||NEW.id,'main',NEW.id,NEW.submitted_at);
END;

CREATE TRIGGER review_delivery_update AFTER UPDATE OF status,claimed_by,claimed_at,claim_generation,nsfw,content_hash ON review_submissions BEGIN
 UPDATE review_deliveries SET revision=revision+1,due_at=0,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE submission_id=NEW.id;
END;

CREATE TRIGGER review_delivery_card AFTER UPDATE OF status,public_blocked,names ON cards BEGIN
 UPDATE review_deliveries SET revision=revision+1,due_at=0,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE submission_id IN(SELECT id FROM review_submissions WHERE card_id=NEW.id);
END;

CREATE TRIGGER review_delivery_card_delete AFTER DELETE ON cards BEGIN
 UPDATE review_deliveries SET revision=revision+1,due_at=0,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE submission_id IN(SELECT id FROM review_submissions WHERE card_id=OLD.id);
END;

CREATE TRIGGER review_stamp_claim_guard BEFORE INSERT ON review_stamps
 WHEN NEW.claim_generation<>'' AND NOT EXISTS (
 SELECT 1 FROM review_submissions s WHERE s.id=NEW.submission_id AND s.status='pending'
 AND s.claimed_by=NEW.member_id AND s.claim_generation=NEW.claim_generation AND s.claimed_at>NEW.created_at-2700000
 AND NOT EXISTS(SELECT 1 FROM reviewers r WHERE r.member_id=NEW.member_id AND r.revoked_at IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'claim changed'); END;

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

PRAGMA defer_foreign_keys = OFF;
