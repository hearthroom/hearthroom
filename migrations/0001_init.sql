-- 角色卡登記表。
--
-- 卡片本體不在這裡，這張表只登記「這張卡在本站上架」；展示欄位全部由定時同步從
-- 上游的公開讀接口拉回來。作者碰不到內容欄位，所以「登記完再偷換成別的東西」
-- 在結構上不可能發生。
--
-- 圖片直接引用來源的 CDN 網址，不轉存。來源那邊撤下圖片 → 這裡跟著斷圖，
-- 這是預期行為：做副本快取等於讓作者失去對自己作品的控制。
CREATE TABLE cards (
  id             TEXT    PRIMARY KEY,
  source_role_id TEXT    NOT NULL UNIQUE,   -- 上游的 roleId，一張卡只登記一次
  author_num_id  INTEGER NOT NULL,          -- 上游的公開數字 ID。內部識別碼一律不落庫
  author_name    TEXT    NOT NULL DEFAULT '',
  author_avatar  TEXT    NOT NULL DEFAULT '',

  -- 一張卡自帶四個語言版本（不是四張卡），所以存成 JSON 而不是四組欄位。
  names          TEXT    NOT NULL DEFAULT '{}',   -- {zh,en,ja,ko}
  summaries      TEXT    NOT NULL DEFAULT '{}',
  avatar_url     TEXT,
  background_url TEXT,
  slug           TEXT,
  tags           TEXT    NOT NULL DEFAULT '[]',

  -- 熱度信號取自上游的真實對話數，不是本站自己數的瀏覽量（那個誰都能刷）。
  -- talk_num_prev 是上一輪同步的值，兩者相減 = 這個窗口的對話增量 = 真正的「熱」。
  talk_num       INTEGER NOT NULL DEFAULT 0,
  follow_num     INTEGER NOT NULL DEFAULT 0,
  talk_num_prev  INTEGER NOT NULL DEFAULT 0,

  -- 熱度用 generated column 而不是自己維護的欄位：SQLite 保證它跟來源永遠一致，
  -- 不可能因為漏掉某條寫入路徑而漂移。STORED 才建得了索引，排序因此走索引掃描，
  -- 不是每行現算。
  hot_score      INTEGER GENERATED ALWAYS AS (talk_num - talk_num_prev) STORED,

  -- 沒有狀態欄位，也沒有下架機制：能不能真的使用一張卡，是上游決定的事，
  -- 這裡做第二套判斷既無必要也做不到。卡片離開榜單只有一種方式——作者自己撤銷登記。
  search_text    TEXT    NOT NULL DEFAULT '',        -- 四語名稱+簡介+標籤，餵 FTS 用
  registered_at  INTEGER NOT NULL,
  last_synced_at INTEGER NOT NULL
);

CREATE INDEX idx_cards_registered ON cards (registered_at DESC);
-- 兩個排序鍵都進索引，否則 SQLite 得為第二個鍵開臨時 B-tree。
CREATE INDEX idx_cards_talk       ON cards (talk_num DESC, follow_num DESC);
CREATE INDEX idx_cards_hot        ON cards (hot_score DESC, registered_at DESC);
CREATE INDEX idx_cards_author            ON cards (author_num_id, registered_at DESC);
CREATE INDEX idx_cards_sync_cursor       ON cards (last_synced_at);

-- trigram tokenizer：unicode61 不切中日韓詞，整句會變成一個 token，中文搜尋等於全滅。
-- 代價是查詢字串要 >= 3 字元，更短的由 cards.ts 走 LIKE fallback 掃同一批資料。
CREATE VIRTUAL TABLE cards_fts USING fts5(
  search_text,
  content='cards',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
END;

-- 只在可搜尋欄位變動時重寫索引；每小時同步只更新計數時不該引發 FTS 重建。
CREATE TRIGGER cards_fts_au AFTER UPDATE OF search_text ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO cards_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;
