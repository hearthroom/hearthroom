ALTER TABLE card_quality_length_scan ADD COLUMN priority_board INTEGER NOT NULL DEFAULT 0;
ALTER TABLE card_quality_length_scan ADD COLUMN priority_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE card_quality_length_scan ADD COLUMN recent_only INTEGER NOT NULL DEFAULT 0 CHECK(recent_only IN (0,1));
