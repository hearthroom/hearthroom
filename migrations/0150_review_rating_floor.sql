-- 管理員更正分級（2026-11-24，任務 2026-11-23-ai-card-review）：作者自填分級不符時，管理員改成正確分級，
-- 並把它設成這張卡的分級下限：作者之後送審時問卷算出的分級比下限低，就提到下限（避免下次更新又掉回去）。
CREATE TABLE review_rating_floors (
  card_id     INTEGER NOT NULL PRIMARY KEY,
  rating      TEXT    NOT NULL CHECK (rating IN ('G','P','PG12','PG15','R')),
  reason      TEXT    NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  set_by      TEXT    NOT NULL,
  set_at      INTEGER NOT NULL
);

-- 分級的等級順序（G < P < PG12 < PG15 < R），給下面的 trigger 比大小；NULL（未分級）最低
-- 卡片的分級不能低於下限：核准時從送審單抄分級、退回後退回舊版本、任何路徑寫進來的分級都在這裡提到下限
CREATE TRIGGER cards_rating_floor AFTER UPDATE OF rating ON cards
WHEN EXISTS (SELECT 1 FROM review_rating_floors f WHERE f.card_id = NEW.id AND
  (CASE f.rating WHEN 'G' THEN 0 WHEN 'P' THEN 1 WHEN 'PG12' THEN 2 WHEN 'PG15' THEN 3 WHEN 'R' THEN 4 ELSE -1 END) >
  (CASE NEW.rating WHEN 'G' THEN 0 WHEN 'P' THEN 1 WHEN 'PG12' THEN 2 WHEN 'PG15' THEN 3 WHEN 'R' THEN 4 ELSE -1 END))
BEGIN
  UPDATE cards SET rating = (SELECT rating FROM review_rating_floors WHERE card_id = NEW.id) WHERE id = NEW.id;
END;

-- 封存版送審單的分級不可改；唯一例外是管理員更正分級時，把待審單提到這張卡的分級下限
DROP TRIGGER hosting_review_immutable;
CREATE TRIGGER hosting_review_immutable BEFORE UPDATE ON review_submissions
WHEN OLD.content_hash LIKE 'version:%' AND (
 NEW.content_hash<>OLD.content_hash OR
 (NEW.rating IS NOT OLD.rating AND NEW.rating IS NOT (SELECT f.rating FROM review_rating_floors f WHERE f.card_id = OLD.card_id)) OR
 NEW.card_id<>OLD.card_id OR NEW.source_role_id<>OLD.source_role_id OR NEW.kind<>OLD.kind
)
BEGIN SELECT RAISE(ABORT,'hosted_revision_immutable'); END;
