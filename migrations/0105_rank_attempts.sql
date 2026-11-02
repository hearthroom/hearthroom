CREATE TABLE rank_attempts(window TEXT NOT NULL,period TEXT NOT NULL,attempted_at INTEGER NOT NULL,PRIMARY KEY(window,period));
-- Completed historical windows are immutable. Persist batch progress so a large
-- cohort can resume without changing the ranking to a partial prefix.
CREATE TABLE rank_window_scores(
 card_id INTEGER NOT NULL REFERENCES rank_publications(card_id) ON DELETE CASCADE,
 window TEXT NOT NULL CHECK(window IN ('day','week','month')),
 from_at INTEGER NOT NULL,to_at INTEGER NOT NULL,heat INTEGER NOT NULL CHECK(heat>=0),scored_at INTEGER NOT NULL,excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN(0,1)),
 PRIMARY KEY(card_id,window),CHECK(to_at>from_at)
);
