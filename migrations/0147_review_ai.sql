-- AI 審卡影子模式（2026-11-23，任務 2026-11-23-ai-card-review）。
-- 審卡員（AI 審核帳號，review_agents）用 CLI 讀卡、寫建議與審核標記。建議只記錄，不改送審狀態；
-- 雙盲：審核員自己做完決定後才看得到（/v1/review/:id/ai），AI 讀卡時也拿不到人工決定。
-- 編號跳過 0146：審卡 V2 第二批（review_submission_diffs）佔用，兩邊互不依賴、可先後任意上線。

-- 一個審卡員、一個判準版本、一張單只留一筆：重寫覆蓋，不累積（重試或改判都是同一筆）。
CREATE TABLE review_ai_suggestions (
  id                TEXT    NOT NULL PRIMARY KEY,
  submission_id     TEXT    NOT NULL,
  card_id           INTEGER,
  agent_member_id   TEXT    NOT NULL,
  criteria_version  TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  -- NULL＝只打了審核標記、還沒下結論
  verdict           TEXT    CHECK (verdict IN ('pass','reject','handoff')),
  reasons           TEXT    NOT NULL DEFAULT '[]',
  flags             TEXT    NOT NULL DEFAULT '[]',
  confidence        REAL,
  -- 交人的原因：拿不準、拒答、輸出不合格、逾時、其他錯誤、卡太大
  handoff_cause     TEXT    CHECK (handoff_cause IN ('unsure','refusal','invalid_output','timeout','error','too_large')),
  note              TEXT    NOT NULL DEFAULT '',
  -- 寫入當下這張單是待審（shadow）還是已定案（backfill，試跑舊單；AI 一樣看不到人工決定）
  phase             TEXT    NOT NULL CHECK (phase IN ('shadow','backfill')),
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cost_usd          REAL,
  latency_ms        INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (submission_id, agent_member_id, criteria_version)
);
CREATE INDEX idx_review_ai_suggestions_time ON review_ai_suggestions (created_at);
CREATE INDEX idx_review_ai_suggestions_criteria ON review_ai_suggestions (criteria_version, created_at);

-- 揭曉後審核員的覆核（AI 判得對／判錯了／兩邊都說得通）也是審核事件：關聯到那一筆建議
ALTER TABLE review_events ADD COLUMN ai_suggestion_id TEXT;
