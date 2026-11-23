-- AI 審卡影子模式（2026-11-23，任務 2026-11-23-ai-card-review）。
-- 審卡員（AI 審核帳號，review_agents）用 CLI 讀卡、寫建議與審核標記。建議只記錄，不改送審狀態；
-- 雙盲：審核員自己做完決定後才看得到（/v1/review/:id/ai），AI 讀卡時也拿不到人工決定。

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

-- 審卡員的專用身分（比照 0107 部落格機器人）：審核員＋AI 審核帳號，沒有任何登入身分。
-- 它只靠 Worker 祕密 REVIEW_AGENT_CONFIG（{memberId, keySha256}）的固定金鑰進來，而且只在 /v1/review-ai/* 有效。
-- 撤銷：把 REVIEW_AGENT_CONFIG 清空，或寫 review_agents.revoked_at。
-- 已經被別的用途佔用（有登入身分、帳號名不對）就讓 migration 失敗，不接管既有帳號。
CREATE TABLE _review_agent_identity_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _review_agent_identity_guard (ok)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM members WHERE id = 'system-review-agent' AND handle <> 'sukirevw')
  OR EXISTS (SELECT 1 FROM members WHERE handle = 'sukirevw' AND id <> 'system-review-agent')
  OR EXISTS (SELECT 1 FROM member_identities WHERE member_id = 'system-review-agent')
  OR EXISTS (SELECT 1 FROM member_connections WHERE owner_member_id = 'system-review-agent')
THEN 0 ELSE 1 END;

INSERT INTO members (id, handle, display_name, created_at, show_stats)
VALUES ('system-review-agent', 'sukirevw', '審卡員', unixepoch() * 1000, 0)
ON CONFLICT(id) DO NOTHING;
INSERT INTO reviewers (member_id, granted_at, granted_by, role)
VALUES ('system-review-agent', unixepoch() * 1000, 'system', 'reviewer')
ON CONFLICT(member_id) DO NOTHING;
INSERT INTO review_agents (member_id, granted_by, granted_at)
VALUES ('system-review-agent', 'system', unixepoch() * 1000)
ON CONFLICT(member_id) DO NOTHING;

INSERT INTO audit_log (id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, before_json, after_json, operation_id, created_at)
VALUES ('system-review-agent-created', 'member', 'system-review-agent', NULL, 'system', 'review_agent_identity_create',
  'Dedicated AI shadow card reviewer; key-only access to review-ai routes, no login identity',
  '{}', '{"handle":"sukirevw","reviewer":true,"reviewAgent":true,"loginIdentity":false}', 'system-review-agent-created', unixepoch() * 1000)
ON CONFLICT(id) DO NOTHING;
DROP TABLE _review_agent_identity_guard;
