-- New rewards snapshot these fields before their first Provider request.
-- Historical pending/paid rows remain NULL: never retrofit an existing award.
ALTER TABLE card_reward_campaigns ADD COLUMN public_days INTEGER NOT NULL DEFAULT 30 CHECK(public_days BETWEEN 1 AND 3650);
ALTER TABLE card_rewards ADD COLUMN retention_role_id TEXT;
ALTER TABLE card_rewards ADD COLUMN public_days INTEGER CHECK(public_days BETWEEN 1 AND 3650);

-- The confirmed consent survives a lost Provider reply or failed D1 cleanup.
CREATE TABLE author_card_deletions (
 member_id TEXT NOT NULL REFERENCES members(id),
 source_role_id TEXT NOT NULL,
 recovery_credits INTEGER NOT NULL CHECK(recovery_credits>=0),
 state TEXT NOT NULL CHECK(state IN ('pending','confirmed','complete','rejected')),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(member_id,source_role_id)
);
