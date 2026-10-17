-- 發卡獎勵活動（創作季）：活動期間每週登記額度提高，期間內第一次登記、通過審核的卡給作者一筆積分。
-- 錢不在這裡：點數池與入帳都在 Provider（跟分享季同一個池），這裡只存活動設定與發放紀錄。
-- 不跟分享季共用 campaigns：那張表的每個讀取點都假設有檔位與證據，加一種活動就要在每處加判斷。
CREATE TABLE card_reward_campaigns (
 id TEXT PRIMARY KEY,
 slug TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*' AND length(slug) BETWEEN 1 AND 40),
 title TEXT NOT NULL DEFAULT '{}',          -- Localized JSON
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL CHECK (ends_at > starts_at),
 payout_deadline INTEGER CHECK (payout_deadline IS NULL OR payout_deadline >= ends_at), -- 這之後還沒發的不再發；NULL＝不設
 weekly_limit INTEGER NOT NULL CHECK (weekly_limit BETWEEN 1 AND 100),
 reward INTEGER NOT NULL CHECK (reward > 0),
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);

-- 一張卡（以 work_key 認：下架重發、改版重審都是同一個作品）一筆有效發放。id 同時是 Provider 的冪等鍵。
-- 狀態同 share_payouts：pending → paid／blocked_insufficient／failed；blocked_insufficient → paid／failed／cancelled；pending 查無夠久 → cancelled。
CREATE TABLE card_rewards (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES card_reward_campaigns(id),
 work_key TEXT NOT NULL,
 card_id INTEGER NOT NULL,
 member_id TEXT NOT NULL REFERENCES members(id),
 recipient_account_no INTEGER NOT NULL CHECK (recipient_account_no > 0), -- 卡的作者（Harbor 公開帳號）
 amount INTEGER NOT NULL CHECK (amount > 0),
 status TEXT NOT NULL DEFAULT 'pending'
   CHECK (status IN ('pending','paid','blocked_insufficient','failed','cancelled')),
 provider_entry_id TEXT,
 error TEXT,
 requested_by TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 1,
 checked_absent_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 settled_at INTEGER
);
-- 同一個作品只能有一筆還在發或已入帳的；失敗與取消的不擋，可以重新發一筆（新的 key）。
CREATE UNIQUE INDEX card_rewards_live ON card_rewards(work_key) WHERE status IN ('pending','blocked_insufficient','paid');
CREATE INDEX card_rewards_status ON card_rewards(status, created_at);
CREATE INDEX card_rewards_member ON card_rewards(member_id, created_at);
CREATE INDEX card_rewards_campaign ON card_rewards(campaign_id, status);

-- 第一期（owner 2026-10-17）：台北 10-17 00:00 到 11-01 00:00，每週 6 張，每張 10000。期間內送審的卡不管何時過審都給，不設發獎截止。
INSERT INTO card_reward_campaigns (id, slug, title, starts_at, ends_at, payout_deadline, weekly_limit, reward, status, created_at, updated_at)
VALUES ('creator-season-1', 'creator-season',
 '{"zh-Hant":"綺夢社創作季","zh-Hans":"绮梦社创作季","en":"Hearthroom Creator Season","ja":"Hearthroom 創作シーズン","ko":"Hearthroom 창작 시즌"}',
 1792166400000, 1793462400000, NULL, 6, 10000, 'active', 1792166400000, 1792166400000);

-- 週額度改讀活動設定：登記那一刻落在某個活動期間就用它的 weekly_limit，否則 3（同 quota.ts 的 weeklyLimitAt）。
-- 其餘條件與 0043 相同。
DROP TRIGGER community_weekly_limit;
CREATE TRIGGER community_weekly_limit BEFORE INSERT ON card_registrations
WHEN NEW.pack_id IS NULL AND
 (SELECT COUNT(DISTINCT work_key) FROM community_registration_usage
  WHERE member_id=COALESCE(
   (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
   (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
  AND registered_at >= ((NEW.registered_at-345600000)/604800000)*604800000+345600000
  AND registered_at < ((NEW.registered_at-345600000)/604800000)*604800000+950400000
 ) >= COALESCE((SELECT MAX(weekly_limit) FROM card_reward_campaigns WHERE status='active' AND starts_at<=NEW.registered_at AND ends_at>NEW.registered_at), 3)
 AND NOT EXISTS (
 SELECT 1 FROM community_registration_usage
 WHERE member_id=COALESCE(
   (SELECT owner_member_id FROM member_connections WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)),
   (SELECT member_id FROM member_identities WHERE provider=NEW.provider AND external_id=CAST(NEW.author_num_id AS TEXT)))
 AND work_key=COALESCE((SELECT w.source_provider||':'||w.source_role_id FROM work_copies cp JOIN works w ON w.id=cp.work_id WHERE cp.provider=NEW.provider AND cp.role_id=NEW.source_role_id),NEW.provider||':'||NEW.source_role_id)
 AND registered_at >= ((NEW.registered_at-345600000)/604800000)*604800000+345600000
 AND registered_at < ((NEW.registered_at-345600000)/604800000)*604800000+950400000
 )
BEGIN
 SELECT RAISE(ABORT,'weekly_quota_exceeded');
END;
