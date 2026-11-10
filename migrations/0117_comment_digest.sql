-- 卡片新評論合併通知（靜默通知，不推播、不發 Discord 私訊）：
-- 同一張卡在作者未讀期間只維護一筆（event_key = card_comments:<card_id>），
-- 只累加 count；已讀後若有新評論，從 1 重新計數。
-- 用 IIF 不用 CASE：wrangler 的 migration 切割器靠 BEGIN／END 數深度，CASE 的 END 會把 trigger 切斷（見 0049）。
CREATE TRIGGER community_card_comments AFTER INSERT ON comments
WHEN NEW.post_id IS NULL AND NEW.card_id > 0 AND NEW.status = 'visible' AND NEW.deleted_at IS NULL
BEGIN
 INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra,delivered,push_at)
 SELECT 'card_comments:'||NEW.card_id,o.member_id,'card_comments','/cards/'||NEW.card_id||'#comments',NEW.created_at,NEW.member_id,NEW.card_id,
  json_object('count',1,'since',NEW.created_at),1,NEW.created_at
 FROM (SELECT DISTINCT card_id,member_id FROM community_card_owners WHERE card_id=NEW.card_id AND member_id IS NOT NULL) o
 WHERE o.member_id<>NEW.member_id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=o.member_id AND p.notifications=0)
 ON CONFLICT(event_key) DO UPDATE SET
  member_id=excluded.member_id,
  path=excluded.path,
  created_at=excluded.created_at,
  actor_id=excluded.actor_id,
  card_id=excluded.card_id,
  delivered=1,
  push_at=excluded.push_at,
  extra=IIF(community_notifications.read_at IS NULL,
   json_set(community_notifications.extra,'$.count',COALESCE(json_extract(community_notifications.extra,'$.count'),0)+1),
   excluded.extra),
  read_at=NULL;
END;

CREATE TRIGGER community_card_comments_hide AFTER UPDATE OF status, deleted_at ON comments
WHEN OLD.post_id IS NULL AND OLD.card_id > 0 AND OLD.status = 'visible' AND OLD.deleted_at IS NULL
 AND (NEW.status <> 'visible' OR NEW.deleted_at IS NOT NULL)
BEGIN
 DELETE FROM community_notifications
 WHERE event_key='card_comments:'||OLD.card_id AND read_at IS NULL AND member_id<>OLD.member_id
  AND OLD.created_at>=COALESCE(json_extract(extra,'$.since'),0)
  AND COALESCE(json_extract(extra,'$.count'),1)<=1;
 UPDATE community_notifications
 SET extra=json_set(extra,'$.count',json_extract(extra,'$.count')-1)
 WHERE event_key='card_comments:'||OLD.card_id AND read_at IS NULL AND member_id<>OLD.member_id
  AND OLD.created_at>=COALESCE(json_extract(extra,'$.since'),0)
  AND COALESCE(json_extract(extra,'$.count'),1)>1;
END;
