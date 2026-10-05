-- 通知要說得出「哪一種」：審核結果分首次上架與更新、退件附上審核員的說明；
-- 追蹤作者的動態分新發佈與更新。0047 的三個 trigger 原樣重建，只多寫 extra。
-- 「新發佈」只有從待審（第一次送審）或作者收回後再公開變成上架；其餘都是更新：
-- 已上架的卡換過審版本、改名，或同步來的卡重審期間是 needs_review、回到 approved。
-- 不能看 approved_version_id：託管卡第一次過審時 hosting_decision 先寫版本、再改 status。
-- 退件說明本來就顯示在作者的「我的卡片」；這裡截 500 字，顯示時再截短。
-- 舊通知沒有這些欄位，顯示端保留原本的句子。

DROP TRIGGER community_review_result;
CREATE TRIGGER community_review_result AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') BEGIN
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
 SELECT o.member_id,'first_work',o.work_id,NEW.decided_at FROM community_card_owners o
 WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL AND NEW.status='approved';
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,card_id,extra)
 SELECT 'review:'||NEW.id,o.member_id,'review_result','/mine',NEW.decided_at,NEW.card_id,json_object('status',NEW.status,'kind',NEW.kind,'note',NULLIF(substr(trim(NEW.note),1,500),''))
 FROM community_card_owners o WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=o.member_id AND p.notifications=0);
END;

DROP TRIGGER community_publication_insert;
CREATE TRIGGER community_publication_insert AFTER INSERT ON cards WHEN NEW.status='approved' AND NEW.public_blocked=0 AND NEW.board_hidden=0 BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id,actor_id,card_id,extra)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/cards/'||NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id,o.member_id,NEW.id,json_object('event','new')
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id WHERE o.card_id=NEW.id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=f.member_id AND p.notifications=0)
 AND NOT EXISTS (SELECT 1 FROM moderation_state s WHERE s.provider=NEW.provider AND s.source_role_id=NEW.source_role_id AND (s.public_blocked=1 OR s.board_hidden=1));
END;

DROP TRIGGER community_publication_update;
CREATE TRIGGER community_publication_update AFTER UPDATE OF status,reviewed_hash,approved_version_id,names,summaries ON cards
 WHEN NEW.status='approved' AND NEW.public_blocked=0 AND NEW.board_hidden=0 AND (OLD.status<>'approved' OR NEW.reviewed_hash<>OLD.reviewed_hash
 OR COALESCE(NEW.approved_version_id,'')<>COALESCE(OLD.approved_version_id,'') OR NEW.names<>OLD.names OR NEW.summaries<>OLD.summaries) BEGIN
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,author_id,actor_id,card_id,extra)
 SELECT 'work:'||o.work_id||':'||COALESCE(NEW.approved_version_id,NULLIF(NEW.reviewed_hash,''),CAST(NEW.last_synced_at AS TEXT))||':'||f.member_id,
 f.member_id,'followed_work','/cards/'||NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER),o.member_id,o.member_id,NEW.id,
 json_object('event',CASE WHEN OLD.status IN ('pending','unshared') THEN 'new' ELSE 'update' END)
 FROM community_card_owners o JOIN member_follows f ON f.author_id=o.member_id WHERE o.card_id=NEW.id
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=f.member_id AND p.notifications=0)
 AND NOT EXISTS (SELECT 1 FROM moderation_state s WHERE s.provider=NEW.provider AND s.source_role_id=NEW.source_role_id AND (s.public_blocked=1 OR s.board_hidden=1));
END;
