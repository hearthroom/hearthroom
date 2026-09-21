-- HearthRoom 精選卡（owner 2026-09-22）：社群代表（在供應商那邊是本站應用的管理員）在本站標記，
-- 本站再用他自己的供應商令牌把標記同步到供應商——精選在供應商那邊決定作者的返點等級，
-- 這裡只留「什麼時候標的」給榜單與卡片頁畫徽章。NULL＝不是精選。
ALTER TABLE cards ADD COLUMN featured_at INTEGER;
CREATE INDEX cards_featured ON cards (featured_at) WHERE featured_at IS NOT NULL;
