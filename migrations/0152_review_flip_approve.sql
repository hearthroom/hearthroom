-- 駁回改判為通過（2026-11-24，任務 2026-11-23-ai-card-review，ui-flip-approve.md）：審核員誤駁回時，管理員用同一個
-- 送審版本開一張「改判單」（新的待審單），由發起人領取後走正常核准。定案過的單不能改狀態（hosting_review_terminal），
-- 所以改判一定是新開一張單。
--   flip_of     改判的是哪一張已駁回的單
--   flip_by     發起的管理員：只有他能領、能處理；他的領取不受 45 分鐘逾時放回影響
--   flip_reason 改判理由（只給審核員看；稽核另記在 audit_log）
-- 改判單待審時不擁有版本列：hosting_versions.submission_id 仍指向原本駁回的那張，作者端讀到的一切照舊是駁回。
-- 核准那一刻才把版本列轉給改判單（同一批寫入），之後照一般核准流程上架、通知作者。
ALTER TABLE review_submissions ADD COLUMN flip_of TEXT;
ALTER TABLE review_submissions ADD COLUMN flip_by TEXT;
ALTER TABLE review_submissions ADD COLUMN flip_reason TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_review_submissions_flip_of ON review_submissions (flip_of) WHERE flip_of IS NOT NULL;

-- 改判單沒有通過就結束（撤回改判＝駁回、作者改稿重送、同步衝突而作廢）：版本列若已轉給它，還給原本駁回的那張，
-- 狀態回到駁回。作者端就跟沒發起過改判一樣。核准時預約的重大更新通知一併清掉：這個 trigger 比 0092 的
-- card_update_cancel 先跑（SQLite 先跑較新的 trigger），版本列一搬走那邊就找不到，留下的預約會擋住之後每一次重大更新。
CREATE TRIGGER review_flip_closed AFTER UPDATE OF status ON review_submissions
WHEN OLD.status='pending' AND NEW.status IN ('rejected','superseded') AND NEW.flip_of IS NOT NULL
BEGIN
 DELETE FROM card_update_events WHERE state='reserved' AND version_id IN (SELECT version_id FROM hosting_versions WHERE submission_id=NEW.id);
 UPDATE hosting_versions SET submission_id=NEW.flip_of, state='rejected' WHERE submission_id=NEW.id;
END;

-- 改判單的領取不逾時：發起人自己蓋章時不看領取時間。其餘照 0037。
DROP TRIGGER review_stamp_claim_guard;
CREATE TRIGGER review_stamp_claim_guard BEFORE INSERT ON review_stamps
 WHEN NEW.claim_generation<>'' AND NOT EXISTS (
 SELECT 1 FROM review_submissions s WHERE s.id=NEW.submission_id AND s.status='pending'
 AND s.claimed_by=NEW.member_id AND s.claim_generation=NEW.claim_generation
 AND (s.claimed_at>NEW.created_at-2700000 OR s.flip_by=NEW.member_id)
 AND NOT EXISTS(SELECT 1 FROM reviewers r WHERE r.member_id=NEW.member_id AND r.revoked_at IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'claim changed'); END;

-- 審核結果通知：撤回改判（改判單駁回）維持原本的駁回結果，不再通知作者。其餘照 0146 原樣重建。
DROP TRIGGER community_review_result;
CREATE TRIGGER community_review_result AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') AND NEW.reopen_of IS NULL
  AND NOT (NEW.flip_of IS NOT NULL AND NEW.status='rejected') BEGIN
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
 SELECT o.member_id,'first_work',o.work_id,NEW.decided_at FROM community_card_owners o
 WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL AND NEW.status='approved';
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,card_id,extra)
 SELECT 'review:'||NEW.id,o.member_id,'review_result',
  CASE WHEN EXISTS(SELECT 1 FROM hosting_versions v WHERE v.submission_id=NEW.id)
        AND (NEW.status='rejected' OR (NEW.status='approved' AND NEW.approve_suggestions IS NOT NULL))
       THEN '/mine/reviews/'||NEW.id ELSE '/mine' END,
  NEW.decided_at,NEW.card_id,
  CASE WHEN NEW.status='rejected' AND NEW.reject_reasons IS NOT NULL
   THEN json_object('status',NEW.status,'kind',NEW.kind,'reasons',json(NEW.reject_reasons))
   WHEN NEW.status='approved' AND NEW.approve_suggestions IS NOT NULL
   THEN json_object('status',NEW.status,'kind',NEW.kind,'suggestions',json(NEW.approve_suggestions))
   ELSE json_object('status',NEW.status,'kind',NEW.kind,'note',NULLIF(substr(trim(NEW.note),1,500),'')) END
 FROM community_card_owners o WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=o.member_id AND p.notifications=0);
END;

-- 首次生效定案事件：撤回改判不是一次新的定案（原本的駁回已經記過），不記；改判通過照常記。其餘照 0145。
DROP TRIGGER review_event_first_decision;
CREATE TRIGGER review_event_first_decision AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') AND NEW.reopen_of IS NULL
  AND NOT (NEW.flip_of IS NOT NULL AND NEW.status='rejected') BEGIN
 INSERT OR IGNORE INTO review_events(event_key,spec_version,submission_id,card_id,at,action,from_state,to_state,actor_kind,reasons,reason_version,coaching)
 VALUES('first:'||NEW.id,1,NEW.id,NEW.card_id,COALESCE(NEW.decided_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),'first_decision','pending',NEW.status,'system',
  CASE WHEN NEW.status='rejected' THEN NEW.reject_reasons END,CASE WHEN NEW.status='rejected' THEN NEW.reason_version END,CASE WHEN NEW.status='rejected' THEN NEW.reject_coaching END);
 DELETE FROM review_submission_devices WHERE submission_id=NEW.id;
END;
