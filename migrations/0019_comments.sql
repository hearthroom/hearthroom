-- 留言：本站自己的事（owner 2026-09-18）。以前留言存在供應商那邊、跟著卡片所在的服務走；
-- 社群留言是社群站的資料，不該要求每一家供應商都替本站養一套留言服務。
--
-- 兩層：頂層留言與其回覆（root_id 指頂層）。留言掛在本站的卡（cards.id）上，寫的人是本站成員——
-- 哪一家登入的都一樣是成員，所以兩家的玩家在同一張卡底下看到的是同一串留言。
-- 刪除是軟刪（deleted_at）：刪頂層連同底下的回覆一起消失。讚是一人一則一票。
-- 卡片撤銷登記時留言不刪：同一張卡再登記回來（卡號不換、id 也不換的情況）討論還在；
-- 列表只在卡片在榜時讀得到。
CREATE TABLE comments (
  id            TEXT    PRIMARY KEY,
  card_id       TEXT    NOT NULL,
  member_id     TEXT    NOT NULL,
  parent_id     TEXT,                          -- 回的是哪一則（頂層或另一則回覆）；頂層為 NULL
  root_id       TEXT,                          -- 所屬的頂層留言；頂層為 NULL
  content       TEXT    NOT NULL,
  reply_to_name TEXT    NOT NULL DEFAULT '',   -- 回覆當下對方的顯示名稱（對方改名不回頭改）
  like_count    INTEGER NOT NULL DEFAULT 0,
  reply_count   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_comments_card_top ON comments (card_id, created_at DESC) WHERE root_id IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_comments_root ON comments (root_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_member_time ON comments (member_id, created_at);

CREATE TABLE comment_likes (
  comment_id TEXT    NOT NULL,
  member_id  TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, member_id)
);
