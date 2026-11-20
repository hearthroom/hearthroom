-- 徽章積分：每位成員每枚徽章領一次（shared/badge-rarity.ts 的 badgeReward）。
-- 發放走活動點數池，鍵是 id（badge-<id>），重試只入帳一次。void＝付款前徽章被撤銷，rejected＝供應商拒絕（看 error）。
CREATE TABLE badge_reward_claims (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 badge TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>0),
 account_no INTEGER NOT NULL,
 claimed_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','void','rejected')),
 error TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 attempted_at INTEGER,
 paid_at INTEGER,
 UNIQUE(member_id,badge)
);
CREATE INDEX badge_reward_claims_due ON badge_reward_claims(status,attempted_at) WHERE status='pending';
