-- 遊戲模式的世界配置（owner 2026-09-09）。
--
-- 一張卡一份 JSON（形狀見 shared/game-spec.ts）：NPC 的模型與站位、地點對照、建築、天空、音效。
-- 由作者在編輯器存，遊戲頁公開讀。存的是上游的 roleId（不是本站 cards.id）：卡不必先登記上榜
-- 就能開遊戲模式，遊戲頁本來就直接對上游拿卡。author_num_id 記存檔人，改動時再跟上游核對一次擁有權。
CREATE TABLE game_worlds (
  role_id       TEXT PRIMARY KEY,
  author_num_id INTEGER NOT NULL,
  spec          TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
