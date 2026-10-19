-- 簽到第一期（2026-10-19，任務 2026-10-19-checkin-hearthroom-experience）。
-- 新手七日的桌寵提示：今天彈過了沒、按了「晚點再說」沒有。綺夢社自己的資料，不是獎勵資料；
-- 一天以台北 04:00 換日，由伺服器算，換裝置不重複彈。
CREATE TABLE checkin_prompts (
  member_id TEXT PRIMARY KEY,
  shown_day TEXT,
  later_day TEXT,
  updated_at INTEGER NOT NULL
);

-- 上報給 Harbor 的獎勵事件：請求裡只寫一列，背景與排程整批送出（src/reward-events.ts）。
-- body 是要送的整筆事件；送出後兩天清掉，送不出去的超過 47 小時丟掉（Harbor 不收 48 小時前的事件）。
CREATE TABLE reward_event_outbox (
  event_id   TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  next_at    INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  sent_at    INTEGER
);
CREATE INDEX idx_reward_event_outbox_due ON reward_event_outbox (next_at) WHERE sent_at IS NULL;

-- 分享連結被打開：同一個訪客同一天只算一次。訪客只有匿名雜湊（IP 前綴＋UA、每週換鑰匙），不存 IP，7 天後清掉。
CREATE TABLE share_opens (
  ref_code     TEXT NOT NULL,
  day          TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (ref_code, day, visitor_hash)
);
CREATE INDEX idx_share_opens_created ON share_opens (created_at);
