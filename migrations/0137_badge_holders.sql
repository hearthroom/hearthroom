-- 「你是第幾位拿到的」與持有人數：按徽章、取得時間掃，不必掃全表。
CREATE INDEX IF NOT EXISTS community_awards_badge_time ON community_awards(badge,created_at);
