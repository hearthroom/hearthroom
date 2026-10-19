-- 簽到第一期（2026-10-19，任務 2026-10-19-checkin-hearthroom-experience）。
-- 新手七日的桌寵提示：今天彈過了沒、按了「晚點再說」沒有。綺夢社自己的資料，不是獎勵資料；
-- 一天以台北 04:00 換日，由伺服器算，換裝置不重複彈。
CREATE TABLE checkin_prompts (
  member_id TEXT PRIMARY KEY,
  shown_day TEXT,
  later_day TEXT,
  updated_at INTEGER NOT NULL
);
