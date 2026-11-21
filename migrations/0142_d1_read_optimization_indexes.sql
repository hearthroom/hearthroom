-- Replace idx_comments_card_top (which required deleted_at IS NULL and was bypassed
-- by listTop's OR (status = 'removed' AND reply_count > 0) filter) with a root-only
-- index ordered by (card_id, created_at DESC, id DESC).
-- Serves listTop COUNT(*), listTop sort=new (without TEMP B-TREE ORDER BY),
-- listTop sort=hot (bounded to the card's root comments), and countTop, while
-- keeping only immutable columns in the index key (zero extra writes on like/reply updates).
DROP INDEX IF EXISTS idx_comments_card_top;
CREATE INDEX idx_comments_card_top_root
  ON comments (card_id, created_at DESC, id DESC)
  WHERE root_id IS NULL;
