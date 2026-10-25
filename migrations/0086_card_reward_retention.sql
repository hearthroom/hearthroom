-- New rewards snapshot these fields before their first Provider request.
-- Historical pending/paid rows remain NULL: never retrofit an existing award.
ALTER TABLE card_reward_campaigns ADD COLUMN public_days INTEGER NOT NULL DEFAULT 30 CHECK(public_days BETWEEN 1 AND 3650);
ALTER TABLE card_rewards ADD COLUMN retention_role_id TEXT;
ALTER TABLE card_rewards ADD COLUMN public_days INTEGER CHECK(public_days BETWEEN 1 AND 3650);
