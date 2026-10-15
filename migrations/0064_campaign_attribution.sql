-- 活動歸因（開業活動設計 §8.1）。不存 IP、UA、網址；成員 id 只在伺服器內部。
CREATE TABLE campaign_attributions (
 member_id TEXT PRIMARY KEY REFERENCES members(id),
 share_code TEXT NOT NULL,
 content_id TEXT NOT NULL REFERENCES share_contents(id),
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 first_seen_at INTEGER NOT NULL,
 registered_at INTEGER NOT NULL,
 first_play_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX campaign_attributions_content ON campaign_attributions(content_id);
CREATE INDEX campaign_attributions_campaign ON campaign_attributions(campaign_id, registered_at);

CREATE TABLE campaign_active_days (
 member_id TEXT NOT NULL REFERENCES members(id),
 day INTEGER NOT NULL,                 -- UTC 日序（epoch ms / 86400000 取整）
 PRIMARY KEY (member_id, day)
);

CREATE TABLE campaign_share_visits (
 share_code TEXT NOT NULL,
 day INTEGER NOT NULL,
 visits INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (share_code, day)
);
