-- 冷凍並討論（審核員 2026-11-08）：審核員把一張卡先擋下來討論。冷凍掛在卡上、不掛在單一張審核單：
-- 作者看不到冷凍，改了內容重送是常態；冷凍若隨舊單作廢而消失，重送一次就能被別人直接通過。
-- 冷凍不過期；只有冷凍人或管理員（要寫理由）能解凍，稽核在 audit_log（subject review_hold）。
CREATE TABLE review_holds (
  card_id       INTEGER NOT NULL PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  member_id     TEXT    NOT NULL,
  -- 冷凍當下的那張單（只做紀錄；判定一律看卡）
  submission_id TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

-- 程式在蓋章前已經擋過；這裡是最後一道：以後任何寫審核章的路徑都繞不過冷凍。
CREATE TRIGGER review_stamp_hold_guard BEFORE INSERT ON review_stamps
 WHEN EXISTS (SELECT 1 FROM review_submissions s JOIN review_holds h ON h.card_id=s.card_id WHERE s.id=NEW.submission_id)
 BEGIN SELECT RAISE(ABORT,'review_held'); END;
