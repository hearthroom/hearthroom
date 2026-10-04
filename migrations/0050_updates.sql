-- 更新說明（What's New）：內容在 updates/*.json，隨程式碼打包；這裡只記生命週期、已讀狀態與送出紀錄。

-- 每則說明第一次被正式 Worker 服務的時間。announce 加一（再公告）時更新 announced_at。
CREATE TABLE update_entries (
  id TEXT PRIMARY KEY,
  first_live_at INTEGER NOT NULL,
  announce INTEGER NOT NULL DEFAULT 1,
  announced_at INTEGER NOT NULL
);

-- 會員的已讀狀態。規則在前端，這裡只存；訪客存在自己的瀏覽器裡。
CREATE TABLE member_update_state (
  member_id TEXT PRIMARY KEY,
  seen_through INTEGER NOT NULL DEFAULT 0,
  strip_closed_at INTEGER NOT NULL DEFAULT 0,
  strip_days INTEGER NOT NULL DEFAULT 0,
  strip_day TEXT NOT NULL DEFAULT '',
  spotlights TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

-- 每天一則 Discord 彙整（台北日期）。revision 在 48 小時內隨內容變動，機器人據此編輯原訊息。
CREATE TABLE update_digests (
  day TEXT PRIMARY KEY,
  entry_ids TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  cutoff INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 彙整送到各語言頻道的狀態（形狀同 review_deliveries）。
CREATE TABLE update_deliveries (
  day TEXT NOT NULL,
  locale TEXT NOT NULL,
  delivered_revision INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT,
  message_id TEXT,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, locale)
);

-- 說明上線時要通知的回報案件（Hearthkeeper）。
CREATE TABLE update_reports (
  entry_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entry_id, case_id)
);
CREATE INDEX update_reports_pending ON update_reports(state, retry_at);

-- /metrics 的 hearthroom_updates_operations_total
CREATE TABLE update_metrics (
  operation TEXT NOT NULL,
  outcome TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (operation, outcome)
);
