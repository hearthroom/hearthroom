-- 審卡 V2 第二批：更新差異（任務 2026-11-23-review-system-v2）。
-- 每張更新單（有過審版本，或駁回後重送）比對的基準版：送審當下固定，之後卡片再怎麼變都不換。
-- 只存基準的封存版號與「改了哪些欄、各改多少」的純量摘要；兩邊的原文不落本站，要看全文時審核頁即時向
-- Harbor 讀封存版（跟審核頁讀本次送審內容同一條、同一道審核員守門）。
CREATE TABLE review_submission_diffs (
  submission_id  TEXT    NOT NULL PRIMARY KEY,
  -- approved：上次過審版（已上架更新）；rejected：上次駁回版（駁回後重送）
  base_kind      TEXT    NOT NULL CHECK (base_kind IN ('approved','rejected')),
  -- 基準版在 Harbor 的封存版號（hosting_versions.hosted_revision_id）；NULL＝沒有可比的版本（舊流程的卡）
  base_revision  TEXT,
  -- pending：還沒算；done：摘要已算；no_base：沒有基準；unreadable：讀不到基準或本次的封存版
  state          TEXT    NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done','no_base','unreadable')),
  -- DiffSummary（只有欄位名稱、計數與布林，見 src/review-diff.ts）
  summary        TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  computed_at    INTEGER
);
CREATE INDEX idx_review_submission_diffs_state ON review_submission_diffs (state, created_at);

-- 單卡紀錄依卡號讀事件、統計依時間讀審核章：沒有這兩個索引每次都掃整張表（code-review 2026-11-23）
CREATE INDEX idx_review_events_card_time ON review_events (card_id, at);
CREATE INDEX idx_review_stamps_created ON review_stamps (created_at);

-- 審核標記（owner 2026-11-23：疑似 AI 原文、疑似搬運）：審核員對這張卡的判斷，只給審核與數據，作者看不到。
-- 記在那一次作業的事件上（JSON 陣列，只有代碼）；作者側寫依作者彙總最近 90 天的次數。
ALTER TABLE review_events ADD COLUMN marks TEXT;

-- 通過並附改進建議（owner 2026-11-23 18:08）：卡片照常通過上架，作者另外收到「可以更好的地方」。
-- 存理由代碼（JSON 陣列，跟駁回同一套；作者端一律用新人輔導版的改法與範例顯示）。
ALTER TABLE review_submissions ADD COLUMN approve_suggestions TEXT;

-- 審核結果通知：通過但附了改進建議的，連到結果頁並帶代碼；其餘照 0145。
DROP TRIGGER community_review_result;
CREATE TRIGGER community_review_result AFTER UPDATE OF status ON review_submissions
 WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') AND NEW.reopen_of IS NULL BEGIN
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
