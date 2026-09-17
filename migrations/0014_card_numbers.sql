-- 卡號：每張登記過的卡一個短數字（玩家回報 2026-09-17：卡片 ID 是一長串，在不能貼連結的地方
-- 報卡、搜卡都不方便；魅魔島那邊是一個短數字）。
--
-- 為什麼另開一張表、而不是在 cards 上加一欄：
--   1. 撤銷登記會刪掉 cards 那一列（unregister），再登記回來若換了號，之前傳出去的號就死了。
--      號要跟著「這家供應商的這張卡」走，不跟著登記那一列走。
--   2. 站內唯一：兩家供應商的上游 ID 各自編號會撞號（0010），本站的卡號由本站發，/cards/123
--      在全站只指一張卡，不必再問是哪一家。
--
-- 既有的卡按登記時間補號，早登記的號小。

CREATE TABLE card_numbers (
  num            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider       TEXT    NOT NULL,
  source_role_id TEXT    NOT NULL,
  UNIQUE (provider, source_role_id)
);

INSERT INTO card_numbers (provider, source_role_id)
SELECT provider, source_role_id FROM cards ORDER BY registered_at ASC, id ASC;
