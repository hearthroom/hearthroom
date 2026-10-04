-- 瀏覽器推播（Web Push）：會員在站上同意後，瀏覽器給一組訂閱（endpoint + 兩把金鑰），
-- 站台之後把通知加密推給那個 endpoint。訂閱是每個瀏覽器一組，一個會員可以有好幾個。
--
-- community_notifications.push_at 記這一則推過沒有：派送只挑 push_at IS NULL 的新通知，
-- 推完就蓋上時間；聚合的按讚通知只在第一次推，之後累加不再推（避免被讚一次響一次）。
CREATE TABLE push_subscriptions (
 id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 locale TEXT,
 created_at INTEGER NOT NULL,
 last_ok INTEGER,
 failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_member ON push_subscriptions(member_id);
ALTER TABLE community_notifications ADD COLUMN push_at INTEGER;
CREATE INDEX community_notifications_push ON community_notifications(push_at,created_at) WHERE push_at IS NULL;
