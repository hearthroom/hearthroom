-- 兩段式決定與定案後保留（2026-11-24，任務 2026-11-23-ai-card-review，owner 02:24 改設計）。
-- 審核員先送「盲審判斷」（只記錄、不改送審狀態）→ 看 AI 的判斷 → 定案（用我的／用 AI 的／修改後）。
-- 盲審判斷是沒看過 AI 的獨立判斷，人機對照用它；定案照舊走蓋章。

-- 每位審核員對每張單一筆，送出後鎖定（用來校準 AI，不能改）。只有本人看得到。
CREATE TABLE review_blind_judgments (
  id               TEXT    NOT NULL PRIMARY KEY,
  submission_id    TEXT    NOT NULL,
  member_id        TEXT    NOT NULL,
  verdict          TEXT    NOT NULL CHECK (verdict IN ('approve','reject')),
  -- 送出時的完整決定（理由代碼、輔導、標記、改進建議、給作者的說明），定案「用我的」時原樣蓋章
  payload          TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE (submission_id, member_id)
);

-- 定案那一章從哪來：blind（用我的）、ai（用 AI 的）、modified（修改後）、human_no_ai（沒等 AI）。
-- 給 AI 的說明（選填）：原因類型（JSON 陣列）＋說明，只給審核與判準調整用，不進作者端。
ALTER TABLE review_events ADD COLUMN final_source TEXT;
ALTER TABLE review_events ADD COLUMN ai_note_types TEXT;
ALTER TABLE review_events ADD COLUMN ai_note TEXT;
ALTER TABLE review_ai_arbitrations ADD COLUMN note_types TEXT NOT NULL DEFAULT '[]';

-- 定案後保留審核快照（查重原文）一段時間給審核員複核與仲裁：一般 7 天；定案與 AI 不一致、還沒仲裁的最長 14 天。
-- 另開一張表記到期時間：review_snapshots 有不可改寫的 trigger。到期由排程把快照與這一列一起刪掉。
CREATE TABLE review_snapshot_retention (
  submission_id    TEXT    NOT NULL PRIMARY KEY,
  decided_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);
CREATE INDEX idx_review_snapshot_retention_expiry ON review_snapshot_retention (expires_at);
