-- 官方部落格（開業活動設計 §6）。本期只有官方寫；author_kind／pending_review／open_to_members 留給下一期投稿。
CREATE TABLE blog_columns (
 id TEXT PRIMARY KEY,
 slug TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*' AND length(slug) BETWEEN 1 AND 40),
 name TEXT NOT NULL,          -- Localized JSON
 description TEXT NOT NULL DEFAULT '{}',
 sort INTEGER NOT NULL DEFAULT 0,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
 open_to_members INTEGER NOT NULL DEFAULT 0 CHECK (open_to_members = 0),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE blog_posts (
 id TEXT PRIMARY KEY,
 column_id TEXT NOT NULL REFERENCES blog_columns(id),
 slug TEXT NOT NULL CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*' AND length(slug) BETWEEN 1 AND 80),
 author_member_id TEXT NOT NULL REFERENCES members(id),
 author_kind TEXT NOT NULL DEFAULT 'official' CHECK (author_kind IN ('official','member')),
 locale TEXT NOT NULL CHECK (locale IN ('zh-Hant','zh-Hans','en','ja','ko')),
 title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
 excerpt TEXT NOT NULL DEFAULT '' CHECK (length(excerpt) <= 300),
 cover_key TEXT,
 body_md TEXT NOT NULL DEFAULT '' CHECK (length(body_md) <= 60000),
 share_title TEXT CHECK (share_title IS NULL OR length(share_title) <= 120),
 share_description TEXT CHECK (share_description IS NULL OR length(share_description) <= 300),
 share_cover_key TEXT,
 campaign_id TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','published','unpublished')),
 publish_at INTEGER,
 first_published_at INTEGER,
 pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
 comments_closed INTEGER NOT NULL DEFAULT 0 CHECK (comments_closed IN (0,1)),
 pinned_comment_id TEXT,
 version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE (column_id, slug)
);
CREATE INDEX blog_posts_public ON blog_posts (status, publish_at DESC) WHERE status = 'published';
CREATE INDEX blog_posts_column ON blog_posts (column_id, publish_at DESC);
CREATE TABLE blog_post_revisions (
 id TEXT PRIMARY KEY,
 post_id TEXT NOT NULL REFERENCES blog_posts(id),
 editor_member_id TEXT NOT NULL REFERENCES members(id),
 title TEXT NOT NULL,
 body_md TEXT NOT NULL,
 meta_json TEXT NOT NULL DEFAULT '{}',
 version INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX blog_post_revisions_post ON blog_post_revisions (post_id, created_at DESC);

-- 文章留言沿用 comments：post_id 有值時 card_id 寫 0（本站卡號從 100001 起，0 不是卡）。
ALTER TABLE comments ADD COLUMN post_id TEXT;
CREATE INDEX idx_comments_post_top ON comments (post_id, created_at DESC) WHERE post_id IS NOT NULL AND root_id IS NULL;
CREATE TRIGGER comments_target_valid BEFORE INSERT ON comments
WHEN (NEW.post_id IS NOT NULL AND NEW.card_id <> 0) OR (NEW.post_id IS NULL AND NEW.card_id <= 0)
BEGIN SELECT RAISE(ABORT, 'comment target invalid'); END;

-- 通知路徑依留言掛在卡還是文章分流；文章留言的 card_id 欄寫 NULL。
-- 用 IIF 不用 CASE：wrangler 的 migration 切割器靠 BEGIN／END 數深度，CASE 的 END 會把 trigger 切斷（見 0049）。
DROP TRIGGER community_comment_reply;
CREATE TRIGGER community_comment_reply AFTER INSERT ON comments WHEN NEW.parent_id IS NOT NULL AND NEW.status='visible' BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra)
 SELECT 'comment:'||NEW.id,c.member_id,'comment_reply',IIF(NEW.post_id IS NOT NULL,'/blog/p/'||NEW.post_id,'/cards/'||NEW.card_id),NEW.created_at,NEW.member_id,NULLIF(NEW.card_id,0),json_object('comment',NEW.id)
 FROM comments c WHERE c.id=NEW.parent_id AND c.member_id<>NEW.member_id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=c.member_id AND p.notifications=0);
END;
DROP TRIGGER community_comment_reply_release;
CREATE TRIGGER community_comment_reply_release AFTER UPDATE OF status ON comments WHEN OLD.status='held' AND NEW.status='visible' AND NEW.parent_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra)
 SELECT 'comment:'||NEW.id,c.member_id,'comment_reply',IIF(NEW.post_id IS NOT NULL,'/blog/p/'||NEW.post_id,'/cards/'||NEW.card_id),COALESCE(NEW.moderated_at,NEW.created_at),NEW.member_id,NULLIF(NEW.card_id,0),json_object('comment',NEW.id)
 FROM comments c WHERE c.id=NEW.parent_id AND c.member_id<>NEW.member_id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=c.member_id AND p.notifications=0);
END;
DROP TRIGGER community_comment_like;
CREATE TRIGGER community_comment_like AFTER INSERT ON comment_likes BEGIN
 INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra,delivered)
 SELECT 'like:'||NEW.comment_id,c.member_id,'comment_like',IIF(c.post_id IS NOT NULL,'/blog/p/'||c.post_id,'/cards/'||c.card_id),NEW.created_at,NEW.member_id,NULLIF(c.card_id,0),
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
