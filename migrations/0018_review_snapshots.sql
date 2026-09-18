-- 審核快照：審核讀取是本站自己的事，不再靠供應商的分享介面（owner 2026-09-18）。
--
-- 作者送審的那一刻，本站用作者自己的 token 讀一次整份設定，存成這張審核單的快照；審核人看快照。
-- 單子一定案（過審或駁回）、或作者撤銷登記，快照就刪——本站只在審核期間暫存作者主動送審的那一份，
-- 不長期保存任何卡片的私有設定。
--
-- cards.reviewed_hash 與 review_submissions.content_hash 從這版起記的是「公開指紋」（pub1: 前綴）：
-- 排程同步匿名就能比對。舊值是供應商給的內容雜湊，沒有前綴，同步時改綁、不重審。
CREATE TABLE review_snapshots (
  submission_id TEXT    PRIMARY KEY,
  detail        TEXT    NOT NULL,   -- 審核頁要的整份設定（JSON）
  created_at    INTEGER NOT NULL
);
