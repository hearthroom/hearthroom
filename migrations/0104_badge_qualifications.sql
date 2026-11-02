CREATE TABLE badge_qualifications (
 member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 account_no INTEGER NOT NULL,
 effective_invites INTEGER NOT NULL CHECK(effective_invites>=0),
 net_topup_usd_micros INTEGER NOT NULL CHECK(net_topup_usd_micros>=0),
 consumed_credits INTEGER NOT NULL CHECK(consumed_credits>=0),
 verified_at INTEGER NOT NULL
);
CREATE TABLE badge_qualification_refresh(member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,receipt TEXT NOT NULL,attempted_at INTEGER NOT NULL);
UPDATE community_badge_definitions SET metric='effective_invites',threshold=CAST(substr(key,8) AS INTEGER) WHERE category='invite';
