-- 管理員更正分級（2026-11-24，任務 2026-11-23-ai-card-review）：作者自填分級不符時，管理員改成正確分級，
-- 並把它設成這張卡的分級下限：作者之後送審時問卷算出的分級比下限低，就提到下限（避免下次更新又掉回去）。
CREATE TABLE review_rating_floors (
  card_id     INTEGER NOT NULL PRIMARY KEY,
  rating      TEXT    NOT NULL CHECK (rating IN ('G','P','PG12','PG15','R')),
  reason      TEXT    NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  set_by      TEXT    NOT NULL,
  set_at      INTEGER NOT NULL
);
