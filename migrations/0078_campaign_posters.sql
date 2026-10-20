-- Exact-locale text posters supplement the original banner. OG continues using banner_key.
ALTER TABLE campaigns ADD COLUMN posters TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(posters) AND json_type(posters)='object');
ALTER TABLE card_reward_campaigns ADD COLUMN posters TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(posters) AND json_type(posters)='object');
