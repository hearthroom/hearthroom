-- 兩家供應商（owner 2026-09-16）：資料完全不混。
--
-- 0001 給 cards.source_role_id 加了單列 UNIQUE（「一張卡只登記一次」），0004 接著補了
-- (provider, source_role_id) 複合唯一索引，並留下一句「拆掉要重建表，會連帶 FTS 觸發器，
-- 將來接第二家供應商時它才是真正的鍵」。現在就是那個時候：上游的卡片 ID 在兩家各自編號，
-- 同一個號在兩家是兩張不同的卡，單列 UNIQUE 會讓第二家登記不上。
--
-- SQLite 不能單獨移除一個約束，只能重建表。重建會換掉 rowid，所以 FTS 的對照要一起重灌。

DROP TRIGGER cards_fts_ai;
DROP TRIGGER cards_fts_ad;
DROP TRIGGER cards_fts_au;

CREATE TABLE cards_rebuilt (
  id             TEXT    PRIMARY KEY,
  source_role_id TEXT    NOT NULL,          -- 上游的 roleId；唯一性由 (provider, source_role_id) 保證
  author_num_id  INTEGER NOT NULL,          -- 上游的公開數字 ID。內部識別碼一律不落庫
  author_name    TEXT    NOT NULL DEFAULT '',
  author_avatar  TEXT    NOT NULL DEFAULT '',
  names          TEXT    NOT NULL DEFAULT '{}',
  summaries      TEXT    NOT NULL DEFAULT '{}',
  avatar_url     TEXT,
  background_url TEXT,
  slug           TEXT,
  tags           TEXT    NOT NULL DEFAULT '[]',
  talk_num       INTEGER NOT NULL DEFAULT 0,
  follow_num     INTEGER NOT NULL DEFAULT 0,
  talk_num_prev  INTEGER NOT NULL DEFAULT 0,
  hot_score      INTEGER GENERATED ALWAYS AS (talk_num - talk_num_prev) STORED,
  search_text    TEXT    NOT NULL DEFAULT '',
  registered_at  INTEGER NOT NULL,
  last_synced_at INTEGER NOT NULL,
  zone           TEXT    NOT NULL DEFAULT 'all',
  provider       TEXT    NOT NULL DEFAULT 'lunatalk',
  status         TEXT    NOT NULL DEFAULT 'approved',
  reviewed_hash  TEXT    NOT NULL DEFAULT '',
  nsfw           INTEGER NOT NULL DEFAULT 0
);

INSERT INTO cards_rebuilt (
  id, source_role_id, author_num_id, author_name, author_avatar, names, summaries, avatar_url,
  background_url, slug, tags, talk_num, follow_num, talk_num_prev, search_text, registered_at,
  last_synced_at, zone, provider, status, reviewed_hash, nsfw
)
SELECT
  id, source_role_id, author_num_id, author_name, author_avatar, names, summaries, avatar_url,
  background_url, slug, tags, talk_num, follow_num, talk_num_prev, search_text, registered_at,
  last_synced_at, zone, provider, status, reviewed_hash, nsfw
FROM cards;

DROP TABLE cards;
ALTER TABLE cards_rebuilt RENAME TO cards;

CREATE INDEX idx_cards_registered ON cards (registered_at DESC);
CREATE INDEX idx_cards_talk       ON cards (talk_num DESC, follow_num DESC);
CREATE INDEX idx_cards_hot        ON cards (hot_score DESC, registered_at DESC);
CREATE INDEX idx_cards_author     ON cards (author_num_id, registered_at DESC);
CREATE INDEX idx_cards_sync_cursor ON cards (last_synced_at);
CREATE INDEX idx_cards_zone_hot   ON cards (zone, hot_score DESC, registered_at DESC);
CREATE INDEX idx_cards_zone_new   ON cards (zone, registered_at DESC);
CREATE INDEX idx_cards_zone_talk  ON cards (zone, talk_num DESC, follow_num DESC);
CREATE INDEX idx_cards_status     ON cards (status);
CREATE UNIQUE INDEX uniq_cards_provider_role ON cards (provider, source_role_id);
-- 榜單、搜尋、作者頁都先按供應商切，這個索引讓那一刀走得動。
CREATE INDEX idx_cards_provider_zone ON cards (provider, zone, registered_at DESC);

CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
END;

CREATE TRIGGER cards_fts_au AFTER UPDATE OF search_text ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO cards_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

-- 重建表換了 rowid，舊的 FTS 對照全部失效：整份清掉重灌，不是補差異。
DELETE FROM cards_fts;
INSERT INTO cards_fts(rowid, search_text) SELECT rowid, search_text FROM cards;

-- 每週登記額度也是按上游的作者數字 ID 算的，兩家會撞號：額度各算各的。
ALTER TABLE card_registrations ADD COLUMN provider TEXT NOT NULL DEFAULT 'lunatalk';
CREATE INDEX idx_registrations_provider_author ON card_registrations (provider, author_num_id, registered_at);
