-- 評分：本站自己的資料（owner 2026-10-11）。一位成員對一張卡一份 1–5 星，可以改、可以收回。
-- 欄位叫 score 不叫 rating：rating 已經是台灣遊戲分級（cards.rating）。
-- 平均與分布每次照這張表現算：一張卡頂多幾千筆，按 card_id 掃一次比維護一組計數欄位簡單、也不會漂。
-- 卡片撤銷登記時不刪：同一張卡再登記回來，分數還在；讀寫只在卡片在榜時開放。
CREATE TABLE card_scores (
  card_id    TEXT    NOT NULL,
  member_id  TEXT    NOT NULL,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (card_id, member_id)
);
