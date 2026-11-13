-- 卡片工坊（Workshop）：公開投影、開關策略、版本紀錄、送審佇列、申訴處理、擴充留言 target 與站內通知。
-- 注意：trigger 內一律用 IIF 不用 CASE（wrangler migration 切割器靠 BEGIN／END 數深度，CASE 的 END 會切斷 trigger）。

CREATE TABLE workshops (
 id TEXT PRIMARY KEY,
 card_id INTEGER NOT NULL,
 provider TEXT NOT NULL DEFAULT 'harbor',
 work_id TEXT NOT NULL,
 source_role_id TEXT NOT NULL,
 author_num_id INTEGER NOT NULL,
 author_member_id TEXT,
 name TEXT NOT NULL DEFAULT '',
 summary TEXT NOT NULL DEFAULT '',
 readme TEXT NOT NULL DEFAULT '',
 cover_url TEXT NOT NULL DEFAULT '',
 kinds TEXT NOT NULL DEFAULT '[]',
 rating TEXT,
 rating_descriptors TEXT NOT NULL DEFAULT '[]',
 version_no INTEGER NOT NULL DEFAULT 0,
 approved_release_id TEXT,
 content_hash TEXT NOT NULL DEFAULT '',
 resident_chars INTEGER NOT NULL DEFAULT 0,
 lore_count INTEGER NOT NULL DEFAULT 0,
 rule_count INTEGER NOT NULL DEFAULT 0,
 opening_count INTEGER NOT NULL DEFAULT 0,
 install_count INTEGER NOT NULL DEFAULT 0,
 moderation_state TEXT NOT NULL DEFAULT 'pending' CHECK(moderation_state IN ('draft','pending','approved','rejected','revoked','deleted')),
 owner_state TEXT NOT NULL DEFAULT 'visible' CHECK(owner_state IN ('visible','returned','hidden_by_owner')),
 owner_reason TEXT,
 owner_acted_at INTEGER,
 owner_action_generation INTEGER NOT NULL DEFAULT 0,
 protected_join_cutoff_seq INTEGER NOT NULL DEFAULT 0,
 appeal_state TEXT CHECK(appeal_state IN ('pending','upheld','restored','revoked')),
 first_published_at INTEGER,
 published_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 comment_revision TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_workshops_card_hot ON workshops(card_id, moderation_state, install_count DESC, first_published_at DESC);
CREATE INDEX idx_workshops_card_new ON workshops(card_id, moderation_state, first_published_at DESC);
CREATE INDEX idx_workshops_work ON workshops(provider, work_id);
CREATE INDEX idx_workshops_author ON workshops(author_num_id);

CREATE TABLE workshop_policies (
 provider TEXT NOT NULL,
 work_id TEXT NOT NULL,
 card_id INTEGER NOT NULL,
 allow_new INTEGER NOT NULL DEFAULT 1 CHECK(allow_new IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0,
 reopen_generation INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(provider, work_id)
);
CREATE INDEX idx_workshop_policies_card ON workshop_policies(card_id);

CREATE TABLE workshop_versions (
 workshop_id TEXT NOT NULL,
 version_no INTEGER NOT NULL,
 release_id TEXT NOT NULL,
 submission_id TEXT,
 update_note TEXT NOT NULL DEFAULT '',
 rating TEXT,
 published_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(workshop_id, version_no),
 UNIQUE(workshop_id, release_id)
);

CREATE TABLE workshop_review_submissions (
 id TEXT PRIMARY KEY,
 workshop_id TEXT NOT NULL,
 card_id INTEGER NOT NULL,
 provider TEXT NOT NULL DEFAULT 'harbor',
 work_id TEXT NOT NULL,
 source_role_id TEXT NOT NULL,
 author_num_id INTEGER NOT NULL,
 author_member_id TEXT NOT NULL,
 card_owner_num_id INTEGER NOT NULL DEFAULT 0,
 kind TEXT NOT NULL CHECK(kind IN ('first','re')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','superseded','withdrawn')),
 publication_state TEXT NOT NULL DEFAULT 'pending' CHECK(publication_state IN ('pending','decided','published')),
 sealed_release_id TEXT NOT NULL,
 operation_id TEXT NOT NULL DEFAULT '',
 content_hash TEXT NOT NULL DEFAULT '',
 name TEXT NOT NULL DEFAULT '',
 summary TEXT NOT NULL DEFAULT '',
 readme TEXT NOT NULL DEFAULT '',
 cover_url TEXT NOT NULL DEFAULT '',
 update_note TEXT NOT NULL DEFAULT '',
 kinds TEXT NOT NULL DEFAULT '[]',
 rating TEXT NOT NULL,
 rating_descriptors TEXT NOT NULL DEFAULT '[]',
 rating_answers TEXT NOT NULL DEFAULT '{}',
 resident_chars INTEGER NOT NULL DEFAULT 0,
 lore_count INTEGER NOT NULL DEFAULT 0,
 rule_count INTEGER NOT NULL DEFAULT 0,
 opening_count INTEGER NOT NULL DEFAULT 0,
 expected_owner_generation INTEGER NOT NULL DEFAULT 0,
 submitted_at INTEGER NOT NULL,
 claimed_by TEXT,
 claimed_at INTEGER,
 claim_generation TEXT NOT NULL DEFAULT '',
 decided_at INTEGER,
 note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_workshop_submissions_pending ON workshop_review_submissions(status, submitted_at ASC);
CREATE INDEX idx_workshop_submissions_workshop ON workshop_review_submissions(workshop_id, submitted_at DESC);
CREATE INDEX idx_workshop_submissions_decided ON workshop_review_submissions(publication_state, decided_at ASC) WHERE publication_state = 'decided';

CREATE TABLE workshop_review_stamps (
 submission_id TEXT NOT NULL,
 member_id TEXT NOT NULL,
 verdict TEXT NOT NULL CHECK(verdict IN ('approve','reject')),
 note TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 claim_generation TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(submission_id, member_id)
);

CREATE TABLE workshop_review_holds (
 workshop_id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL,
 submission_id TEXT NOT NULL,
 created_at INTEGER NOT NULL
);

CREATE TABLE workshop_appeals (
 id TEXT PRIMARY KEY,
 workshop_id TEXT NOT NULL,
 card_id INTEGER NOT NULL,
 provider TEXT NOT NULL DEFAULT 'harbor',
 work_id TEXT NOT NULL,
 creator_num_id INTEGER NOT NULL DEFAULT 0,
 creator_member_id TEXT,
 card_owner_num_id INTEGER NOT NULL DEFAULT 0,
 owner_state_snapshot TEXT NOT NULL,
 owner_reason_snapshot TEXT NOT NULL DEFAULT '',
 owner_acted_at INTEGER,
 owner_action_generation INTEGER NOT NULL DEFAULT 0,
 appeal_reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','restored','revoked')),
 decided_by TEXT,
 decision_reason TEXT,
 operation_id TEXT,
 sync_state TEXT NOT NULL DEFAULT 'complete' CHECK(sync_state IN ('syncing','complete')),
 created_at INTEGER NOT NULL,
 decided_at INTEGER
);
CREATE UNIQUE INDEX idx_workshop_appeals_open ON workshop_appeals(workshop_id) WHERE status = 'pending';
CREATE INDEX idx_workshop_appeals_status ON workshop_appeals(status, created_at ASC);

CREATE TABLE card_workshop_interest (
 provider TEXT NOT NULL,
 work_id TEXT NOT NULL,
 card_id INTEGER NOT NULL,
 member_id TEXT NOT NULL,
 draft_name TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 PRIMARY KEY(provider, work_id, member_id)
);

CREATE TABLE workshop_sync_events (
 event_key TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 created_at INTEGER NOT NULL
);

CREATE TABLE workshop_outbox_cursor (
 provider TEXT PRIMARY KEY,
 last_seq INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);

ALTER TABLE community_notifications ADD COLUMN workshop_id TEXT;

-- 擴充留言沿用 comments：workshop_id 有值時 card_id 寫 0、post_id 為 NULL。
ALTER TABLE comments ADD COLUMN workshop_id TEXT;
CREATE INDEX idx_comments_workshop_top ON comments (workshop_id, created_at DESC) WHERE workshop_id IS NOT NULL AND root_id IS NULL;

DROP TRIGGER IF EXISTS comments_target_valid;
CREATE TRIGGER comments_target_valid BEFORE INSERT ON comments
WHEN NOT (
 (NEW.card_id > 0 AND NEW.post_id IS NULL AND NEW.workshop_id IS NULL)
 OR (NEW.card_id = 0 AND NEW.post_id IS NOT NULL AND NEW.workshop_id IS NULL)
 OR (NEW.card_id = 0 AND NEW.post_id IS NULL AND NEW.workshop_id IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'comment target invalid'); END;

CREATE TABLE comment_reports_new (
 id TEXT PRIMARY KEY,
 target_kind TEXT NOT NULL CHECK(target_kind IN ('card','post','workshop')),
 comment_id TEXT NOT NULL,
 reporter_member_id TEXT NOT NULL REFERENCES members(id),
 reason TEXT NOT NULL CHECK(reason IN ('spam','abuse','sexual','privacy','other')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 300),
 created_at INTEGER NOT NULL,
 resolved_at INTEGER,
 resolution TEXT CHECK(resolution IN ('removed','dismissed','released','deleted')),
 resolved_by TEXT,
 UNIQUE(target_kind, comment_id, reporter_member_id)
);
INSERT INTO comment_reports_new SELECT * FROM comment_reports;
DROP TABLE comment_reports;
ALTER TABLE comment_reports_new RENAME TO comment_reports;
CREATE INDEX comment_reports_open ON comment_reports(target_kind, comment_id) WHERE resolved_at IS NULL;

DROP TRIGGER IF EXISTS community_comment_reply;
CREATE TRIGGER community_comment_reply AFTER INSERT ON comments WHEN NEW.parent_id IS NOT NULL AND NEW.status='visible' BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,workshop_id,extra)
 SELECT 'comment:'||NEW.id,c.member_id,'comment_reply',
  IIF(NEW.post_id IS NOT NULL,'/blog/p/'||NEW.post_id,IIF(NEW.workshop_id IS NOT NULL,'/workshops/'||NEW.workshop_id,'/cards/'||NEW.card_id)),
  NEW.created_at,NEW.member_id,NULLIF(NEW.card_id,0),NEW.workshop_id,json_object('comment',NEW.id)
 FROM comments c WHERE c.id=NEW.parent_id AND c.member_id<>NEW.member_id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=c.member_id AND p.notifications=0);
END;

DROP TRIGGER IF EXISTS community_comment_like;
CREATE TRIGGER community_comment_like AFTER INSERT ON comment_likes BEGIN
 INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,workshop_id,extra,delivered)
 SELECT 'like:'||NEW.comment_id,c.member_id,'comment_like',
  IIF(c.post_id IS NOT NULL,'/blog/p/'||c.post_id,IIF(c.workshop_id IS NOT NULL,'/workshops/'||c.workshop_id,'/cards/'||c.card_id)),
  NEW.created_at,NEW.member_id,NULLIF(c.card_id,0),c.workshop_id,
  json_object('comment',NEW.comment_id,'count',(SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=NEW.comment_id AND l.member_id<>c.member_id)),1
 FROM comments c WHERE c.id=NEW.comment_id AND c.member_id<>NEW.member_id AND c.deleted_at IS NULL
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=c.member_id AND (p.notifications=0 OR p.like_notifications=0))
 ON CONFLICT(event_key) DO UPDATE SET
  actor_id=excluded.actor_id,
  extra=json_set(extra,'$.count',json_extract(excluded.extra,'$.count')),
  created_at=IIF(json_extract(excluded.extra,'$.count')>json_extract(extra,'$.count') AND (json_extract(excluded.extra,'$.count') IN (2,3,5,10,25,50,100,250,500,1000,2500,5000) OR (json_extract(excluded.extra,'$.count')>=10000 AND json_extract(excluded.extra,'$.count')%10000=0)),excluded.created_at,created_at),
  read_at=IIF(json_extract(excluded.extra,'$.count')>json_extract(extra,'$.count') AND (json_extract(excluded.extra,'$.count') IN (2,3,5,10,25,50,100,250,500,1000,2500,5000) OR (json_extract(excluded.extra,'$.count')>=10000 AND json_extract(excluded.extra,'$.count')%10000=0)),NULL,read_at),
  push_at=IIF(json_extract(excluded.extra,'$.count')>json_extract(extra,'$.count') AND (json_extract(excluded.extra,'$.count') IN (2,3,5,10,25,50,100,250,500,1000,2500,5000) OR (json_extract(excluded.extra,'$.count')>=10000 AND json_extract(excluded.extra,'$.count')%10000=0)),NULL,push_at);
END;
