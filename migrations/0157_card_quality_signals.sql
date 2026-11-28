-- The only content-derived fields retained here are rounded character counts
-- and structural counts. A pending revision cannot replace the approved row.
CREATE TABLE card_quality_lengths (
  version_id TEXT PRIMARY KEY REFERENCES hosting_versions(version_id) ON DELETE CASCADE,
  total_chars INTEGER NOT NULL,
  setting_chars INTEGER,
  worldbook_entries INTEGER NOT NULL,
  worldbook_chars INTEGER NOT NULL,
  opening_count INTEGER NOT NULL,
  opening_chars INTEGER NOT NULL,
  opening_page INTEGER NOT NULL CHECK(opening_page IN (0,1)),
  display_rules INTEGER NOT NULL,
  panel INTEGER NOT NULL CHECK(panel IN (0,1))
);

CREATE TABLE card_quality_play (
  card_id INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  players INTEGER NOT NULL CHECK(players >= 0),
  reached INTEGER NOT NULL CHECK(reached >= 0 AND reached <= players),
  median_turns REAL NOT NULL CHECK(median_turns >= 0)
);

CREATE TABLE card_quality_length_scan (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  cursor_time INTEGER NOT NULL DEFAULT 9007199254740991,
  cursor_id INTEGER NOT NULL DEFAULT 0,
  lease TEXT NOT NULL DEFAULT '',
  run_after INTEGER NOT NULL DEFAULT 0
);

INSERT INTO card_quality_length_scan(singleton) VALUES(1);

-- Partition the short public statistics cache at each score or vote-count change.
ALTER TABLE cards ADD COLUMN score_revision TEXT NOT NULL DEFAULT '';
CREATE TRIGGER card_quality_score_insert AFTER INSERT ON card_scores BEGIN
  UPDATE cards SET score_revision=lower(hex(randomblob(16))) WHERE id=NEW.card_id;
END;
CREATE TRIGGER card_quality_score_update AFTER UPDATE OF score ON card_scores
WHEN OLD.score<>NEW.score BEGIN
  UPDATE cards SET score_revision=lower(hex(randomblob(16))) WHERE id=NEW.card_id;
END;
CREATE TRIGGER card_quality_score_delete AFTER DELETE ON card_scores BEGIN
  UPDATE cards SET score_revision=lower(hex(randomblob(16))) WHERE id=OLD.card_id;
END;
