-- 重新審核（審核員 2026-11-08，卡 100855）：已發布的卡由一位審核員發起重審。
-- 重審單是一張普通的待審單，只多記「重審的是哪一張已通過的單」與發起人、理由：
-- 待審清單、領取、冷凍、讀完整內容都照原本的路走。卡片在重審期間照常公開；
-- 「維持通過」只結束這張單，「駁回」走改判（限管理員）。理由只給審核員看。
ALTER TABLE review_submissions ADD COLUMN reopen_of TEXT;
ALTER TABLE review_submissions ADD COLUMN reopened_by TEXT;
ALTER TABLE review_submissions ADD COLUMN reopen_reason TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_review_submissions_reopen ON review_submissions (reopen_of) WHERE reopen_of IS NOT NULL;

-- 重審的那一版已經不是公開版（作者的新版本先過審）：重審單作廢，免得「維持通過」去動現在的版本。
-- 改判把原單駁回時不在這裡處理（原單已不是 approved），由改判自己結束重審單。
CREATE TRIGGER review_reopen_stale AFTER UPDATE OF approved_version_id ON cards
WHEN NEW.approved_version_id IS NOT OLD.approved_version_id
BEGIN
 UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL,claim_generation='',decided_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE card_id=NEW.id AND status='pending' AND reopen_of IS NOT NULL
 AND EXISTS (SELECT 1 FROM review_submissions o WHERE o.id=review_submissions.reopen_of AND o.status='approved');
 DELETE FROM review_snapshots WHERE submission_id IN (SELECT id FROM review_submissions WHERE card_id=NEW.id AND status='superseded' AND reopen_of IS NOT NULL);
END;

-- 重審的結果不另外通知作者：維持通過＝什麼都沒變；駁回走改判，改判自己會通知（附駁回說明）。
-- 其餘照 0051 原樣重建。
DROP TRIGGER community_review_result;
CREATE TRIGGER community_review_result AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') AND NEW.reopen_of IS NULL BEGIN
 INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
 SELECT o.member_id,'first_work',o.work_id,NEW.decided_at FROM community_card_owners o
 WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL AND NEW.status='approved';
 INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,card_id,extra)
 SELECT 'review:'||NEW.id,o.member_id,'review_result','/mine',NEW.decided_at,NEW.card_id,json_object('status',NEW.status,'kind',NEW.kind,'note',NULLIF(substr(trim(NEW.note),1,500),''))
 FROM community_card_owners o WHERE o.card_id=NEW.card_id AND o.member_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=o.member_id AND p.notifications=0);
END;
