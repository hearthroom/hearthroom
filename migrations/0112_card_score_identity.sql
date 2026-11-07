-- D1 runs this whole file and its migration receipt in one atomic batch.
-- Accept only the observed legacy .0 representation; unexpected data aborts
-- before deleting anything. Never bypass the test-account or retirement fences.
CREATE TABLE card_score_identity_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO card_score_identity_guard
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM card_scores
  WHERE CAST(card_id AS INTEGER) <= 0
     OR card_id NOT IN (CAST(CAST(card_id AS INTEGER) AS TEXT), CAST(CAST(card_id AS INTEGER) AS TEXT) || '.0')
) AND NOT EXISTS (
  SELECT 1 FROM card_scores s
  WHERE (s.card_id LIKE '%.0' OR EXISTS (
    SELECT 1 FROM card_scores d
    WHERE d.card_id = s.card_id || '.0' AND d.member_id = s.member_id
  )) AND (
    EXISTS (SELECT 1 FROM members m WHERE m.id = s.member_id AND m.account_class = 'test')
    OR EXISTS (SELECT 1 FROM legacy_account_fence f WHERE f.member_id = s.member_id)
    OR EXISTS (SELECT 1 FROM community_card_owners o JOIN members m ON m.id = o.member_id
               WHERE o.card_id = CAST(s.card_id AS INTEGER) AND m.account_class = 'test')
  )
) THEN 1 ELSE 0 END;

-- Latest updated_at wins, then created_at. Exact ties prefer the canonical key.
DELETE FROM card_scores WHERE rowid IN (
  SELECT rowid FROM (
    SELECT rowid, ROW_NUMBER() OVER (
      PARTITION BY member_id, CAST(card_id AS INTEGER)
      ORDER BY updated_at DESC, created_at DESC, card_id ASC
    ) AS position FROM card_scores
  ) WHERE position > 1
);
UPDATE card_scores SET card_id = CAST(CAST(card_id AS INTEGER) AS TEXT)
WHERE card_id LIKE '%.0';
DROP TABLE card_score_identity_guard;

-- Keep the existing table, primary key and account-protection triggers intact.
-- A canonical positive integer string plus the existing primary key guarantees
-- one rating per member/card, without rebuilding the table or duplicating indexes.
CREATE TRIGGER card_scores_canonical_insert BEFORE INSERT ON card_scores
WHEN NEW.card_id <> CAST(CAST(NEW.card_id AS INTEGER) AS TEXT) OR CAST(NEW.card_id AS INTEGER) <= 0
BEGIN SELECT RAISE(ABORT, 'card_score_id_invalid'); END;
CREATE TRIGGER card_scores_canonical_update BEFORE UPDATE OF card_id ON card_scores
WHEN NEW.card_id <> CAST(CAST(NEW.card_id AS INTEGER) AS TEXT) OR CAST(NEW.card_id AS INTEGER) <= 0
BEGIN SELECT RAISE(ABORT, 'card_score_id_invalid'); END;
