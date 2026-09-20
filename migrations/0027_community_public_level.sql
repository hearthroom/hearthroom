-- Level sharing requires separate consent; existing badge consent is preserved.
ALTER TABLE community_preferences ADD COLUMN public_level INTEGER NOT NULL DEFAULT 0;
