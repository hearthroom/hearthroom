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
