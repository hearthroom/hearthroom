-- 審卡員的作者筆記（任務 2026-11-23-ai-card-review）：審卡員自己對一位作者記的觀察（例如「常用同一個設定模板」），
-- 下次讀這位作者的卡時帶回來。一位作者一份，覆蓋寫入；只在 /v1/review-ai/* 用金鑰讀寫，作者端與公開路由都沒有入口。
-- 寫空字串＝刪掉這一列。長度上限在程式裡先擋（給可讀的錯誤），這裡的 CHECK 是最後一道。
CREATE TABLE review_ai_author_notes (
  author_member_id TEXT    NOT NULL PRIMARY KEY,
  note             TEXT    NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  agent_member_id  TEXT    NOT NULL,
  updated_at       INTEGER NOT NULL
);
