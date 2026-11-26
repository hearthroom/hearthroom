-- 推廣貼文逐篇歸因（任務 2026-11-25-post-attribution）：每篇貼文的代號是已登記的 utm_campaign。
-- 每個成員至多一列（點了之後才建立帳號的新玩家），只存代號與時間；不存 IP、UA、網址或推薦碼。
-- 寫入只在登入後綁定一次、首聊補一次時間；查詢只給按代號聚合。
CREATE TABLE promo_attributions (
 member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 campaign TEXT NOT NULL,
 first_seen_at INTEGER NOT NULL,
 registered_at INTEGER NOT NULL,
 first_play_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX promo_attributions_campaign ON promo_attributions(campaign, registered_at);
