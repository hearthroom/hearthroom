-- Publication approval and community distribution are independent authorities.
ALTER TABLE reviewers ADD COLUMN role TEXT NOT NULL DEFAULT 'reviewer' CHECK(role IN ('reviewer','manager','owner'));
ALTER TABLE cards ADD COLUMN board_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN public_blocked INTEGER NOT NULL DEFAULT 0;
CREATE TABLE moderation_state (
 provider TEXT NOT NULL, source_role_id TEXT NOT NULL,
 board_hidden INTEGER NOT NULL DEFAULT 0, public_blocked INTEGER NOT NULL DEFAULT 0,
 tags_override TEXT, PRIMARY KEY(provider,source_role_id)
);
CREATE TABLE moderation_cases (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_role_id TEXT NOT NULL,
 version_id TEXT NOT NULL, title TEXT NOT NULL, author_member_id TEXT NOT NULL,
 card_number INTEGER NOT NULL, nsfw INTEGER NOT NULL, public_evidence TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('delist','suspend','restore_listing','restore_public')),
 reason TEXT NOT NULL, created_by TEXT NOT NULL, operation_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','disputed','confirmed','dismissed')),
 created_at INTEGER NOT NULL, decided_at INTEGER, resolved_by TEXT, resolution TEXT,
 UNIQUE(created_by,operation_id)
);
CREATE UNIQUE INDEX moderation_open_case ON moderation_cases(provider,source_role_id) WHERE status IN ('pending','disputed');
CREATE TABLE moderation_blocked_versions (version_id TEXT NOT NULL, case_id TEXT NOT NULL REFERENCES moderation_cases(id), PRIMARY KEY(version_id,case_id));
CREATE TABLE moderation_votes (
 case_id TEXT NOT NULL REFERENCES moderation_cases(id), member_id TEXT NOT NULL,
 vote TEXT NOT NULL CHECK(vote IN ('confirm','oppose')), reason TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(case_id,member_id)
);
CREATE TABLE moderation_events (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_role_id TEXT NOT NULL,
 actor TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL,
 before_value TEXT NOT NULL, after_value TEXT NOT NULL, created_at INTEGER NOT NULL,
 operation_id TEXT NOT NULL, UNIQUE(actor,operation_id)
);
CREATE TABLE moderation_compensation (
 event_id TEXT PRIMARY KEY REFERENCES moderation_events(id), provider TEXT NOT NULL, source_role_id TEXT NOT NULL,
 board TEXT NOT NULL CHECK(board IN ('day','week','month')), milliseconds INTEGER NOT NULL CHECK(milliseconds>0)
);
CREATE TABLE moderation_clock (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO moderation_clock(id) VALUES(1);
CREATE TABLE moderation_metrics (operation TEXT NOT NULL,outcome TEXT NOT NULL,value INTEGER NOT NULL,PRIMARY KEY(operation,outcome));

-- All effects occur with the vote/case transaction, including concurrent votes.
CREATE TRIGGER moderation_vote_guard BEFORE INSERT ON moderation_votes
WHEN NOT EXISTS(SELECT 1 FROM moderation_cases k WHERE k.id=NEW.case_id AND k.status='pending' AND k.author_member_id<>NEW.member_id)
 OR EXISTS(SELECT 1 FROM moderation_cases k WHERE k.id=NEW.case_id AND k.action='restore_public' AND NOT EXISTS(SELECT 1 FROM cards c WHERE c.provider=k.provider AND c.source_role_id=k.source_role_id AND COALESCE(c.approved_version_id,c.reviewed_hash)=k.version_id))
 OR NOT EXISTS(SELECT 1 FROM reviewers WHERE member_id=NEW.member_id AND revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT,'moderation_conflict'); END;
CREATE TRIGGER moderation_vote_effect AFTER INSERT ON moderation_votes
BEGIN
 UPDATE moderation_cases SET status='disputed' WHERE id=NEW.case_id AND NEW.vote='oppose';
 UPDATE moderation_cases SET status='confirmed',decided_at=NEW.created_at
 WHERE id=NEW.case_id AND status='pending' AND (SELECT count(*) FROM moderation_votes WHERE case_id=NEW.case_id AND vote='confirm')>=2;
END;
CREATE TRIGGER moderation_suspend AFTER INSERT ON moderation_cases WHEN NEW.action='suspend'
BEGIN
 INSERT OR IGNORE INTO moderation_blocked_versions SELECT v.version_id,NEW.id FROM hosting_versions v JOIN cards c ON c.id=v.card_id WHERE c.provider=NEW.provider AND c.source_role_id=NEW.source_role_id AND v.state='approved';
 UPDATE moderation_state SET public_blocked=1 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id;
END;
CREATE TRIGGER moderation_decision AFTER UPDATE OF status ON moderation_cases WHEN NEW.status='confirmed'
BEGIN
 INSERT OR IGNORE INTO moderation_blocked_versions SELECT v.version_id,NEW.id FROM hosting_versions v JOIN cards c ON c.id=v.card_id WHERE NEW.action='restore_public' AND c.provider=NEW.provider AND c.source_role_id=NEW.source_role_id AND v.state='approved' AND v.version_id<>NEW.version_id;
 DELETE FROM moderation_blocked_versions WHERE version_id=NEW.version_id AND NEW.action='restore_public';
 UPDATE moderation_state SET board_hidden=1 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id AND NEW.action='delist';
 UPDATE moderation_state SET board_hidden=0 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id AND NEW.action='restore_listing';
 UPDATE moderation_state SET public_blocked=0 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id AND NEW.action='restore_public';
END;
CREATE TRIGGER moderation_dismiss AFTER UPDATE OF status ON moderation_cases WHEN NEW.status='dismissed' AND NEW.action='suspend'
BEGIN
 DELETE FROM moderation_blocked_versions WHERE case_id=NEW.id;
 UPDATE moderation_state SET public_blocked=0 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id;
END;
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
CREATE TRIGGER moderation_compensation_cache AFTER INSERT ON moderation_compensation
BEGIN UPDATE moderation_clock SET revision=revision+1 WHERE id=1; END;

-- An approval during restoration invalidates the old proposal, never reopens a work.
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
