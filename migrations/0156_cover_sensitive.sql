-- Cover flags belong to the permanent source card number, across review versions
-- and withdrawal/relisting. Existing cards begin with both flags off.
ALTER TABLE card_numbers ADD COLUMN cover_author_sensitive INTEGER NOT NULL DEFAULT 0 CHECK (cover_author_sensitive IN (0,1));
ALTER TABLE card_numbers ADD COLUMN cover_review_sensitive INTEGER NOT NULL DEFAULT 0 CHECK (cover_review_sensitive IN (0,1));
ALTER TABLE card_numbers ADD COLUMN cover_review_url TEXT;

CREATE TRIGGER cover_sensitive_board_revision
AFTER UPDATE OF cover_author_sensitive, cover_review_sensitive ON card_numbers
WHEN (OLD.cover_author_sensitive OR OLD.cover_review_sensitive) <> (NEW.cover_author_sensitive OR NEW.cover_review_sensitive)
 AND EXISTS (SELECT 1 FROM cards WHERE id=NEW.num AND status='approved')
BEGIN
  UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
END;
