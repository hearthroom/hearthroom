-- AI 分歧仲裁（2026-11-23，任務 2026-11-23-ai-card-review，owner 22:22）：管理員看人工與 AI 結論相反的單，
-- 判誰對。仲裁不改原決定、不通知作者；可重新仲裁，每次一筆，統計取每筆建議最後一次仲裁。
-- 同時寫一筆審核事件（ai_arbitration，關聯 AI 建議），與揭曉後的覆核（ai_feedback）共用事件表。
CREATE TABLE review_ai_arbitrations (
  id               TEXT    NOT NULL PRIMARY KEY,
  suggestion_id    TEXT    NOT NULL,
  submission_id    TEXT    NOT NULL,
  member_id        TEXT    NOT NULL,
  -- 人對／AI 對／都說得通／都不對
  value            TEXT    NOT NULL CHECK (value IN ('human_right','ai_right','both_ok','both_wrong')),
  -- 仲裁當下的分歧方向與人工結論：之後決定被改判（重新審核）也照當時的樣子統計與顯示
  direction        TEXT    NOT NULL CHECK (direction IN ('ai_stricter','human_stricter')),
  human_decision   TEXT    NOT NULL CHECK (human_decision IN ('approved','rejected')),
  -- 分歧裡「不過」那一邊當時的理由代碼（AI 較嚴取 AI 的、人較嚴取人工的），統計各理由人錯／AI 錯用
  reasons          TEXT    NOT NULL DEFAULT '[]',
  -- 加入參考範例：只有人對或 AI 對能勾；池＝仲裁後的正確結論
  reference_pool   TEXT    CHECK (reference_pool IN ('pass','reject')),
  note             TEXT    NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  operation_id     TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE (member_id, operation_id)
);
CREATE INDEX idx_review_ai_arbitrations_suggestion ON review_ai_arbitrations (suggestion_id, created_at);
CREATE INDEX idx_review_ai_arbitrations_pool ON review_ai_arbitrations (reference_pool, created_at) WHERE reference_pool IS NOT NULL;

-- 揭曉與報表找「每位審核員對每筆建議最後一次覆核」
CREATE INDEX idx_review_events_ai_suggestion ON review_events (ai_suggestion_id, actor_member_id, at) WHERE ai_suggestion_id IS NOT NULL;
