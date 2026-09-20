-- Separate community identity; Discord is never a conversation provider.
CREATE TABLE community_preferences (
 member_id TEXT PRIMARY KEY REFERENCES members(id), public_badges INTEGER NOT NULL DEFAULT 0,
 notifications INTEGER NOT NULL DEFAULT 0, discord_dm INTEGER NOT NULL DEFAULT 0,
 case_access INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE community_subjects (
 discord_id TEXT PRIMARY KEY, xp_enabled INTEGER NOT NULL DEFAULT 1,
 revision TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))), dirty INTEGER NOT NULL DEFAULT 1,
 sync_state TEXT NOT NULL DEFAULT 'pending', synced_at INTEGER, retry_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE discord_links (
 member_id TEXT PRIMARY KEY REFERENCES members(id), discord_id TEXT NOT NULL UNIQUE REFERENCES community_subjects(discord_id),
 name TEXT NOT NULL, version TEXT NOT NULL UNIQUE, state TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL
);
CREATE TABLE discord_link_attempts (
 state TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), nonce TEXT NOT NULL,
 expires INTEGER NOT NULL, receipt TEXT UNIQUE, discord_id TEXT, name TEXT, consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX discord_attempt_member ON discord_link_attempts(member_id,expires);
CREATE TABLE community_xp (
 event_id TEXT PRIMARY KEY, discord_id TEXT NOT NULL REFERENCES community_subjects(discord_id),
 event_time INTEGER NOT NULL, points INTEGER NOT NULL, rule TEXT NOT NULL DEFAULT 'chat-v1'
);
CREATE INDEX community_xp_subject_time ON community_xp(discord_id,event_time);
CREATE TABLE community_awards (
 member_id TEXT NOT NULL REFERENCES members(id), badge TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(member_id,badge)
);
CREATE TABLE community_nonces (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE community_metrics (operation TEXT NOT NULL,outcome TEXT NOT NULL,value INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(operation,outcome));
CREATE TABLE community_notifications (
 id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), event_key TEXT NOT NULL UNIQUE, member_id TEXT NOT NULL REFERENCES members(id), kind TEXT NOT NULL, path TEXT NOT NULL, author_id TEXT,
 created_at INTEGER NOT NULL, read_at INTEGER, delivered INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX community_notifications_member ON community_notifications(member_id,created_at DESC);
CREATE TABLE community_case_jobs (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), discord_id TEXT NOT NULL, link_version TEXT NOT NULL,
 payload TEXT NOT NULL, result TEXT, status TEXT NOT NULL DEFAULT 'pending', expires INTEGER NOT NULL,
 lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX community_case_member ON community_case_jobs(member_id,expires);
CREATE TRIGGER community_link_insert AFTER INSERT ON discord_links BEGIN
 UPDATE community_subjects SET revision=lower(hex(randomblob(16))),dirty=1,sync_state='pending' WHERE discord_id=NEW.discord_id;
END;
CREATE TRIGGER community_link_update AFTER UPDATE ON discord_links BEGIN
 UPDATE community_subjects SET revision=lower(hex(randomblob(16))),dirty=1,sync_state='pending' WHERE discord_id=NEW.discord_id;
END;
CREATE TRIGGER community_xp_insert AFTER INSERT ON community_xp WHEN NEW.points>0 BEGIN
 UPDATE community_subjects SET revision=lower(hex(randomblob(16))),dirty=1,sync_state='pending' WHERE discord_id=NEW.discord_id;
END;
CREATE TRIGGER community_award_insert AFTER INSERT ON community_awards BEGIN
 UPDATE community_subjects SET revision=lower(hex(randomblob(16))),dirty=1,sync_state='pending'
 WHERE discord_id IN (SELECT discord_id FROM discord_links WHERE member_id=NEW.member_id AND state='active');
END;
CREATE VIEW community_card_owners AS
 SELECT c.id AS card_id, COALESCE(mc.owner_member_id,mi.member_id) AS member_id,
 COALESCE(wc.work_id,w.id,c.provider||':'||c.source_role_id) AS work_id
 FROM cards c LEFT JOIN member_identities mi ON mi.provider=c.provider AND mi.external_id=CAST(c.author_num_id AS TEXT)
 LEFT JOIN member_connections mc ON mc.provider=c.provider AND mc.external_id=CAST(c.author_num_id AS TEXT)
 LEFT JOIN work_copies wc ON wc.provider=c.provider AND wc.role_id=c.source_role_id
 LEFT JOIN works w ON w.source_provider=c.provider AND w.source_role_id=c.source_role_id;
CREATE TABLE community_review_signal (id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
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
CREATE TRIGGER community_publication_insert AFTER INSERT ON cards WHEN NEW.status='approved' BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/library',CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id
 JOIN community_preferences p ON p.member_id=f.member_id AND p.notifications=1 WHERE o.card_id=NEW.id;
END;
CREATE TRIGGER community_publication_update AFTER UPDATE OF status,reviewed_hash,approved_version_id,names,summaries ON cards
 WHEN NEW.status='approved' AND (OLD.status<>'approved' OR NEW.reviewed_hash<>OLD.reviewed_hash
 OR COALESCE(NEW.approved_version_id,'')<>COALESCE(OLD.approved_version_id,'') OR NEW.names<>OLD.names OR NEW.summaries<>OLD.summaries) BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/library',CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id
 JOIN community_preferences p ON p.member_id=f.member_id AND p.notifications=1 WHERE o.card_id=NEW.id;
END;
CREATE INDEX community_subjects_pending ON community_subjects(dirty,retry_at);
CREATE INDEX community_subjects_recheck ON community_subjects(synced_at);
CREATE INDEX community_notifications_pending ON community_notifications(delivered,retry_at);
