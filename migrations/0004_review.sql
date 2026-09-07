-- 社群審核：成員、審核人、審核單，以及卡片的審核狀態。
--
-- 這是對 0001 裡「沒有狀態欄、沒有審核」那句話的有意識翻轉（2026-09-07）：
-- 上榜前要經過本站社群自己的審核。主站仍然是內容的唯一擁有者；本站多擁有的只有
-- 「哪張卡在審核的哪一步」與「誰蓋了章」。
--
-- 成員與身分：本站沒有原生登入，成員是第一次以某家供應商登入時自動建立的；一個成員
-- 可以綁多家供應商的身分（現在只有 lunatalk）。主鍵是本站自己產生的不透明 id，不帶
-- 供應商前綴——連結與合併時才不用改外鍵。卡片的作者欄位維持「供應商上的公開 ID」，
-- 判斷成員是不是作者看身分表。
--
-- 審核人是成員的一個標記，初期由站方手動登記（scripts/grant-reviewer.mjs）。
--
-- 審核單（review_submissions）：一張卡每次提交一單。kind 分初審（first，從沒過過）與
-- 重審（re，過過之後內容變了）；初審要兩個不同的人蓋章，重審一個。任何人駁回即駁回。
-- 領取（claimed_by/at）是共享佇列的「我正在看這張」標記，逾時自動視為放回，不另開排程。
--
-- 卡片狀態（cards.status）：pending 待審、approved 在榜、rejected 駁回、needs_review
-- 過審後內容變了待重審、unshared 作者收回了讀取授權。榜單、搜尋、標籤、作者榜只算 approved。
-- 既有的卡一律 approved：它們登記時沒有審核這回事，追溯要求重審對作者不公平；
-- reviewed_hash 留空，作者下次提交才綁上內容版本。
--
-- 唯一鍵改成（供應商，來源卡片 ID）：source_role_id 的 UNIQUE 留著不動（拆掉要重建表，
-- 會連帶 FTS 觸發器），多加一個複合唯一索引，將來接第二家供應商時它才是真正的鍵。

CREATE TABLE members (
  id         TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE member_identities (
  provider     TEXT    NOT NULL,
  external_id  TEXT    NOT NULL,   -- 供應商上的公開 ID（lunatalk = accountNumId）
  member_id    TEXT    NOT NULL,
  display_name TEXT    NOT NULL DEFAULT '',
  linked_at    INTEGER NOT NULL,
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX idx_identities_member ON member_identities (member_id);

CREATE TABLE reviewers (
  member_id  TEXT    PRIMARY KEY,
  granted_at INTEGER NOT NULL,
  granted_by TEXT    NOT NULL DEFAULT '',   -- 'manual' 或之後 Discord bot 的代號
  revoked_at INTEGER
);

ALTER TABLE cards ADD COLUMN provider      TEXT NOT NULL DEFAULT 'lunatalk';
ALTER TABLE cards ADD COLUMN status        TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE cards ADD COLUMN reviewed_hash TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX uniq_cards_provider_role ON cards (provider, source_role_id);
CREATE INDEX idx_cards_status ON cards (status);

CREATE TABLE review_submissions (
  id             TEXT    PRIMARY KEY,
  card_id        TEXT    NOT NULL,
  provider       TEXT    NOT NULL,
  source_role_id TEXT    NOT NULL,
  kind           TEXT    NOT NULL,              -- first | re
  status         TEXT    NOT NULL,              -- pending | approved | rejected
  content_hash   TEXT    NOT NULL DEFAULT '',   -- 提交當下主站回的內容雜湊
  submitted_at   INTEGER NOT NULL,
  claimed_by     TEXT,
  claimed_at     INTEGER,
  decided_at     INTEGER,
  note           TEXT    NOT NULL DEFAULT ''    -- 駁回時給作者的說明
);
CREATE INDEX idx_submissions_status_time ON review_submissions (status, submitted_at);
CREATE INDEX idx_submissions_card ON review_submissions (card_id);

CREATE TABLE review_stamps (
  submission_id TEXT    NOT NULL,
  member_id     TEXT    NOT NULL,
  verdict       TEXT    NOT NULL,   -- approve | reject
  note          TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (submission_id, member_id)
);
