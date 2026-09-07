-- 登記流水。
--
-- cards 表只記「現在在榜上的」：撤銷登記就刪行，所以從它數不出「這週登記過幾張」——
-- 登記三張、撤掉、再登記三張，cards 裡永遠只有三張。每週額度要靠一份不刪的流水：
-- 每次成功登記記一行，額度看這週有幾個不同的 role 登記過（同一張卡撤了再登不重複計）。
CREATE TABLE card_registrations (
  author_num_id  INTEGER NOT NULL,   -- 上游的公開數字 ID，跟 cards 一樣不落內部識別碼
  source_role_id TEXT    NOT NULL,
  registered_at  INTEGER NOT NULL
);

CREATE INDEX idx_registrations_author_time ON card_registrations (author_num_id, registered_at);
