-- AI 有沒有說服審核員（owner 2026-11-24，任務 2026-11-23-ai-card-review）：人機分歧時，審核員評 AI 的理由說得好不好，
-- 和仲裁「誰對」是兩件事。每位審核員對每筆分歧（AI 建議）一列，改選就覆蓋（updated_at 跟著動），統計取這一列＝最後一次選擇。
-- 不寫審核事件、不動仲裁與快照保留期。
-- suggestion_at：評的時候那筆 AI 建議的 updated_at。AI 重判（同一筆建議覆寫）後，之前的評價針對的是舊理由，不再計入。
CREATE TABLE review_ai_persuasion (
  suggestion_id  TEXT    NOT NULL,
  member_id      TEXT    NOT NULL,
  submission_id  TEXT    NOT NULL,
  value          TEXT    NOT NULL CHECK (value IN ('convinced','not_convinced')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  suggestion_at  INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, member_id)
);
-- 本週被說服比例按 updated_at 取 UTC 週
CREATE INDEX review_ai_persuasion_updated ON review_ai_persuasion(updated_at);
