-- 通知要說得出「誰」「哪張卡」「發生了什麼」，而且預設就要送。
--
-- 之前 community_notifications 只有 kind 與 path，站內只能顯示「追蹤的作者有新作品」這種空話；
-- 兩種通知的落點還不對（followed_work 指 /library、review_result 指 /mine）。更根本的是所有
-- trigger 都要求偏好列存在且 notifications=1，而偏好列預設 0、只在改偏好時才建立——上線以來
-- 316 位會員只有 1 位開過，歷來只產生過 1 則通知（owner 2026-10-04 唯讀查核）。
--
-- 這次：
-- 1. members.locale 記介面語言，給 Discord 私訊選語言用。放 members 而不放偏好表，因為偏好列
--    一旦被順手 INSERT 就帶了「使用者有選擇」的語意。
-- 2. 通知多 actor_id／card_id／extra（JSON：審核狀態、聚合數、留言 id）。
-- 3. 偏好表重建：notifications 預設 1、既有列回填 1（內測期、只有 1 位開過，不存在被回填掉的
--    明確關閉）；新增 like_notifications 預設 1。Discord 私訊維持 opt-in。
-- 4. trigger 改成「沒有明確關閉就送」，落點指到卡片本身；退件卡的 /cards/<id> 會 404，所以
--    review_result 仍指 /mine、卡名放在通知內容。
-- 5. 新增留言按讚通知：同一則留言同一天合併成一條、排除自讚、寫入即 delivered=1 所以永遠不會
--    變成 Discord 私訊。

ALTER TABLE members ADD COLUMN locale TEXT;
ALTER TABLE community_notifications ADD COLUMN actor_id TEXT;
ALTER TABLE community_notifications ADD COLUMN card_id INTEGER;
ALTER TABLE community_notifications ADD COLUMN extra TEXT;

-- 四個 trigger 的本體引用偏好表，表重建前要先拆掉，否則 DROP TABLE 會在 trigger 重新解析時失敗。
DROP TRIGGER community_review_result;
DROP TRIGGER community_comment_reply;
DROP TRIGGER community_publication_insert;
DROP TRIGGER community_publication_update;

CREATE TABLE community_preferences_v2 (
 member_id TEXT PRIMARY KEY REFERENCES members(id), public_badges INTEGER NOT NULL DEFAULT 0,
 notifications INTEGER NOT NULL DEFAULT 1, discord_dm INTEGER NOT NULL DEFAULT 0,
 case_access INTEGER NOT NULL DEFAULT 0, public_level INTEGER NOT NULL DEFAULT 0, featured_badges TEXT,
 like_notifications INTEGER NOT NULL DEFAULT 1
);
INSERT INTO community_preferences_v2(member_id,public_badges,notifications,discord_dm,case_access,public_level,featured_badges)
 SELECT member_id,public_badges,1,discord_dm,case_access,public_level,featured_badges FROM community_preferences;
DROP TABLE community_preferences;
ALTER TABLE community_preferences_v2 RENAME TO community_preferences;
-- DROP TABLE 連同 0032 掛在這張表上的三個公開快照失效 trigger 一起拿掉了，原樣補回。
CREATE TRIGGER snapshot_community_preferences_insert AFTER INSERT ON community_preferences BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
END;
CREATE TRIGGER snapshot_community_preferences_update AFTER UPDATE ON community_preferences BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id AND OLD.member_id<>NEW.member_id;
END;
CREATE TRIGGER snapshot_community_preferences_delete AFTER DELETE ON community_preferences BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=OLD.member_id;
END;

CREATE TRIGGER community_review_result AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') BEGIN
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
 SELECT o.member_id,'first_work',o.work_id,NEW.decided_at FROM community_card_owners o
 WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL AND NEW.status='approved';
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,card_id,extra)
 SELECT 'review:'||NEW.id,o.member_id,'review_result','/mine',NEW.decided_at,NEW.card_id,json_object('status',NEW.status)
 FROM community_card_owners o WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=o.member_id AND p.notifications=0);
END;

CREATE TRIGGER community_comment_reply AFTER INSERT ON comments WHEN NEW.parent_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra)
 SELECT 'comment:'||NEW.id,c.member_id,'comment_reply','/cards/'||NEW.card_id,NEW.created_at,NEW.member_id,NEW.card_id,json_object('comment',NEW.id)
 FROM comments c WHERE c.id=NEW.parent_id AND c.member_id<>NEW.member_id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=c.member_id AND p.notifications=0);
END;

CREATE TRIGGER community_comment_like AFTER INSERT ON comment_likes BEGIN
 INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra,delivered)
 SELECT 'like:'||NEW.comment_id||':'||strftime('%Y-%m-%d',NEW.created_at/1000,'unixepoch'),c.member_id,'comment_like','/cards/'||c.card_id,NEW.created_at,NEW.member_id,c.card_id,json_object('comment',NEW.comment_id,'count',1),1
 FROM comments c WHERE c.id=NEW.comment_id AND c.member_id<>NEW.member_id AND c.deleted_at IS NULL
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=c.member_id AND (p.notifications=0 OR p.like_notifications=0))
 ON CONFLICT(event_key) DO UPDATE SET actor_id=excluded.actor_id,created_at=excluded.created_at,read_at=NULL,
  extra=json_set(extra,'$.count',json_extract(extra,'$.count')+1);
END;

CREATE TRIGGER community_publication_insert AFTER INSERT ON cards WHEN NEW.status='approved' AND NEW.public_blocked=0 AND NEW.board_hidden=0 BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id,actor_id,card_id)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/cards/'||NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id,o.member_id,NEW.id
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id WHERE o.card_id=NEW.id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=f.member_id AND p.notifications=0)
 AND NOT EXISTS (SELECT 1 FROM moderation_state s WHERE s.provider=NEW.provider AND s.source_role_id=NEW.source_role_id AND (s.public_blocked=1 OR s.board_hidden=1));
END;

CREATE TRIGGER community_publication_update AFTER UPDATE OF status,reviewed_hash,approved_version_id,names,summaries ON cards
 WHEN NEW.status='approved' AND NEW.public_blocked=0 AND NEW.board_hidden=0 AND (OLD.status<>'approved' OR NEW.reviewed_hash<>OLD.reviewed_hash
 OR COALESCE(NEW.approved_version_id,'')<>COALESCE(OLD.approved_version_id,'') OR NEW.names<>OLD.names OR NEW.summaries<>OLD.summaries) BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id,actor_id,card_id)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/cards/'||NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id,o.member_id,NEW.id
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id WHERE o.card_id=NEW.id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=f.member_id AND p.notifications=0)
 AND NOT EXISTS (SELECT 1 FROM moderation_state s WHERE s.provider=NEW.provider AND s.source_role_id=NEW.source_role_id AND (s.public_blocked=1 OR s.board_hidden=1));
END;
