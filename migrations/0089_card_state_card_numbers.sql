-- 共用狀態的三張表改以卡號（card_numbers.num）為外鍵，不再要求社群站已有卡片列（cards）。
--
-- 為什麼：作者在還沒有卡片列的卡上也要能測投票與計數——新建的私卡（沒送審、沒設過能見度）
-- 和 CLI 推的試玩卡都沒有 cards 列，原本綁 cards(id) 的外鍵讓作者一寫就失敗。卡號跟之後
-- 送審或設能見度時 upsertCard 給的 cards.id 是同一個號碼，所以作者的試玩數字接得上。
-- 不另外替這些卡補建 cards 列：沒有能見度防護的卡片列可能讓私卡被連結預覽讀到。
--
-- 代價：刪掉卡片列時不再連帶刪除這幾張表的資料（card_numbers 從不刪）。總數與開關不含個資；
-- 個人那一列仍跟著 members(id) 一起刪。分享短碼與資格快取仍綁 cards(id)：沒有卡片列的卡不發短碼。
--
-- SQLite 不能改外鍵：建新表 → 複製 → 刪舊表 → 改名，索引在改名之後重建（舊索引跟著舊表消失）。
-- 沒有其他表參照這三張表。

CREATE TABLE card_state_totals_new (
 card_id INTEGER NOT NULL REFERENCES card_numbers(num),
 ns TEXT NOT NULL CHECK(ns IN ('live','draft','test')),
 scope TEXT NOT NULL,
 key TEXT NOT NULL,
 period TEXT NOT NULL,
 option TEXT NOT NULL DEFAULT '',
 value INTEGER NOT NULL DEFAULT 0,
 reached_at INTEGER,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(card_id, ns, scope, key, period, option)
);
INSERT INTO card_state_totals_new (card_id, ns, scope, key, period, option, value, reached_at, updated_at)
 SELECT card_id, ns, scope, key, period, option, value, reached_at, updated_at FROM card_state_totals;
DROP TABLE card_state_totals;
ALTER TABLE card_state_totals_new RENAME TO card_state_totals;

CREATE TABLE card_state_members_new (
 card_id INTEGER NOT NULL REFERENCES card_numbers(num),
 ns TEXT NOT NULL CHECK(ns IN ('live','draft','test')),
 scope TEXT NOT NULL,
 key TEXT NOT NULL,
 period TEXT NOT NULL,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 option TEXT NOT NULL DEFAULT '',
 previous TEXT NOT NULL DEFAULT '',
 value INTEGER NOT NULL DEFAULT 0,
 last_delta INTEGER NOT NULL DEFAULT 0,
 changes INTEGER NOT NULL DEFAULT 0,
 changes_day TEXT NOT NULL DEFAULT '',
 rev TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(card_id, ns, scope, key, period, member_id)
);
INSERT INTO card_state_members_new (card_id, ns, scope, key, period, member_id, option, previous, value, last_delta, changes, changes_day, rev, updated_at)
 SELECT card_id, ns, scope, key, period, member_id, option, previous, value, last_delta, changes, changes_day, rev, updated_at FROM card_state_members;
DROP TABLE card_state_members;
ALTER TABLE card_state_members_new RENAME TO card_state_members;
CREATE INDEX card_state_members_rank ON card_state_members(card_id, ns, scope, key, period, value DESC, updated_at);
CREATE INDEX card_state_members_member ON card_state_members(member_id);

CREATE TABLE card_state_controls_new (
 card_id INTEGER PRIMARY KEY REFERENCES card_numbers(num),
 author_off INTEGER NOT NULL DEFAULT 0,
 platform_off INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
INSERT INTO card_state_controls_new (card_id, author_off, platform_off, updated_at)
 SELECT card_id, author_off, platform_off, updated_at FROM card_state_controls;
DROP TABLE card_state_controls;
ALTER TABLE card_state_controls_new RENAME TO card_state_controls;
