-- 留言按讚通知改成「一則留言一條、人數算真的、只有里程碑才再提醒」。
--
-- 0047 的版本是每天一條、每個讚累加並重設未讀：取消再按會灌水，熱門留言每個讚都把那條推回
-- 最上面、標回未讀，頭部作者一天會被敲幾千次。主流做法（IG／X／Threads 聚合一條原地更新，
-- Reddit／Threads 高流量只在里程碑提醒）：
-- - 同一則留言終身一條（event_key = like:<comment>），文字顯示最近一位 + 其他人數。
-- - 人數直接數 comment_likes 現在按著的人（不含作者自己），不累加；取消再按不會變兩個人，也不會
--   因為重新回到同一個里程碑而再提醒（只有人數高於上次記下的才算）。
-- - 第 1 個讚新建（未讀、推播）；之後只有人數到 2、3、5、10、25、50、100、250、500、1000、
--   2500、5000、每萬時才重設未讀／推播／時間，其餘的讚只默默更新人數與最近一位。
-- Discord 私訊維持不送（delivered=1 寫入）。舊的每日列保留，自然過期。
-- 用 IIF 不用 CASE：wrangler 的 migration 切割器靠 BEGIN／END 數深度，CASE 的 END 會把 trigger 切斷。
DROP TRIGGER community_comment_like;
CREATE TRIGGER community_comment_like AFTER INSERT ON comment_likes BEGIN
 INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra,delivered)
 SELECT 'like:'||NEW.comment_id,c.member_id,'comment_like','/cards/'||c.card_id,NEW.created_at,NEW.member_id,c.card_id,
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
