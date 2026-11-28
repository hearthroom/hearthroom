ALTER TABLE card_quality_play ADD COLUMN verified_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE card_quality_play_sync (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  cursor INTEGER NOT NULL DEFAULT 0,
  lease TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO card_quality_play_sync (singleton) VALUES (1);
