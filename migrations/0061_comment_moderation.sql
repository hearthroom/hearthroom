-- 留言審核（開業活動設計 §7）與共用稽核、計數、運營設定（§9.1、§11、§2.1）。

-- 稽核：只追加。Worker 沒有改或刪它的路徑；UPDATE 由觸發器擋。
-- ponytail: DELETE 不用觸發器擋，因為測試的 resetDb 要清表；正式環境靠「程式沒有刪除路徑」＋這份測試守。
CREATE TABLE audit_log (
 id TEXT PRIMARY KEY,
 subject_kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 actor_member_id TEXT,
 actor_kind TEXT NOT NULL CHECK(actor_kind IN ('human','ai','system')),
 action TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 before_json TEXT NOT NULL DEFAULT '{}',
 after_json TEXT NOT NULL DEFAULT '{}',
 operation_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(actor_member_id, operation_id)
);
CREATE INDEX audit_log_subject ON audit_log(subject_kind, subject_id, created_at DESC);
CREATE INDEX audit_log_time ON audit_log(created_at DESC);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- 各功能共用的操作計數（/metrics 依 metric 分開輸出、各自列舉合法值）。
CREATE TABLE ops_metrics (metric TEXT NOT NULL, operation TEXT NOT NULL, outcome TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(metric, operation, outcome));

-- 本站運營設定：沒設的鍵＝那一條規則不啟用。
CREATE TABLE community_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at INTEGER NOT NULL);

-- AI 審核帳號：本身是審核人（reviewers 有列），多一列標記它是代理。
CREATE TABLE review_agents (member_id TEXT PRIMARY KEY REFERENCES members(id), granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL, revoked_at INTEGER);

-- 留言審核狀態。removed／deleted 同時帶 deleted_at（既有查詢與徽章照舊排除它們）；held 只給本人看。
ALTER TABLE comments ADD COLUMN status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','held','removed','deleted'));
ALTER TABLE comments ADD COLUMN hold_reason TEXT;
ALTER TABLE comments ADD COLUMN moderated_by TEXT;
ALTER TABLE comments ADD COLUMN moderated_at INTEGER;
ALTER TABLE comments ADD COLUMN moderation_reason TEXT;
UPDATE comments SET status='deleted' WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_comments_held ON comments(created_at) WHERE status='held';

CREATE TABLE comment_reports (
 id TEXT PRIMARY KEY,
 target_kind TEXT NOT NULL CHECK(target_kind IN ('card','post')),
 comment_id TEXT NOT NULL,
 reporter_member_id TEXT NOT NULL REFERENCES members(id),
 reason TEXT NOT NULL CHECK(reason IN ('spam','abuse','sexual','privacy','other')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 300),
 created_at INTEGER NOT NULL,
 resolved_at INTEGER,
 resolution TEXT CHECK(resolution IN ('removed','dismissed','released')),
 resolved_by TEXT,
 UNIQUE(target_kind, comment_id, reporter_member_id)
);
CREATE INDEX comment_reports_open ON comment_reports(target_kind, comment_id) WHERE resolved_at IS NULL;

-- until 為 NULL＝永久。只禁止留言。
CREATE TABLE comment_mutes (member_id TEXT PRIMARY KEY REFERENCES members(id), until INTEGER, reason TEXT NOT NULL, by_member_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE comment_keywords (id TEXT PRIMARY KEY, pattern TEXT NOT NULL UNIQUE CHECK(length(pattern) BETWEEN 1 AND 100), created_by TEXT NOT NULL, created_at INTEGER NOT NULL);

-- 回覆通知：被攔下的回覆不通知；放行那一刻才通知（event_key 相同，不會重複）。
DROP TRIGGER community_comment_reply;
CREATE TRIGGER community_comment_reply AFTER INSERT ON comments WHEN NEW.parent_id IS NOT NULL AND NEW.status='visible' BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra)
 SELECT 'comment:'||NEW.id,c.member_id,'comment_reply','/cards/'||NEW.card_id,NEW.created_at,NEW.member_id,NEW.card_id,json_object('comment',NEW.id)
 FROM comments c WHERE c.id=NEW.parent_id AND c.member_id<>NEW.member_id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=c.member_id AND p.notifications=0);
END;
CREATE TRIGGER community_comment_reply_release AFTER UPDATE OF status ON comments WHEN OLD.status='held' AND NEW.status='visible' AND NEW.parent_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra)
 SELECT 'comment:'||NEW.id,c.member_id,'comment_reply','/cards/'||NEW.card_id,NEW.created_at,NEW.member_id,NEW.card_id,json_object('comment',NEW.id)
 FROM comments c WHERE c.id=NEW.parent_id AND c.member_id<>NEW.member_id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=c.member_id AND p.notifications=0);
END;
