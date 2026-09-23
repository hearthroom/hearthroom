-- 角色設定查重索引（owner 2026-09-23）。
--
-- 這一版改了 0018 的保存承諾：審核快照照舊定案就刪，但送審的角色設定會留下「指紋」——
-- 連續幾個字算出的雜湊，只能拿來比對，還原不出原文。語料＝排隊中與已過審的卡；
-- 駁回、作者改稿作廢、排隊中撤回的單，指紋跟著刪。過審卡作者撤下後指紋仍保留，
-- 後來的卡照樣比得到它。結果只給審核人看，作者看不到，也不自動擋卡。演算法見 src/originality.ts。
CREATE TABLE originality_texts (
  id            INTEGER PRIMARY KEY,
  submission_id TEXT    NOT NULL UNIQUE,
  card_id       TEXT    NOT NULL,
  member_id     TEXT    NOT NULL,
  algorithm     TEXT    NOT NULL,
  unit_count    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX originality_texts_card ON originality_texts(card_id);

CREATE TABLE originality_prints (
  hash    INTEGER NOT NULL,
  text_id INTEGER NOT NULL,
  PRIMARY KEY (hash, text_id)
) WITHOUT ROWID;
CREATE INDEX originality_prints_text ON originality_prints(text_id);

CREATE TRIGGER originality_text_gone AFTER DELETE ON originality_texts
BEGIN
  DELETE FROM originality_prints WHERE text_id = OLD.id;
END;

-- 駁回、改稿作廢：這一版不進語料
CREATE TRIGGER originality_submission_dropped AFTER UPDATE OF status ON review_submissions
WHEN NEW.status IN ('rejected', 'superseded')
BEGIN
  DELETE FROM originality_texts WHERE submission_id = NEW.id;
END;

-- 新版過審：同一張卡只留最新過審的那一版，舊版不再重複佔位。
-- 只有這一版自己有指紋才換：公開資料變更自動開的重審單沒有快照、沒有指紋，過審時不能清掉舊的。
CREATE TRIGGER originality_submission_approved AFTER UPDATE OF status ON review_submissions
WHEN NEW.status = 'approved' AND EXISTS (SELECT 1 FROM originality_texts WHERE submission_id = NEW.id)
BEGIN
  -- 留下的這一版繼承這張卡第一次進索引的時間：審核頁靠它判斷誰先送審
  UPDATE originality_texts SET created_at = (SELECT MIN(created_at) FROM originality_texts WHERE card_id = NEW.card_id)
    WHERE submission_id = NEW.id;
  DELETE FROM originality_texts WHERE card_id = NEW.card_id AND submission_id <> NEW.id
    AND submission_id IN (SELECT id FROM review_submissions WHERE card_id = NEW.card_id AND status = 'approved');
END;

-- 排隊中撤回（單子直接刪掉）
CREATE TRIGGER originality_submission_deleted AFTER DELETE ON review_submissions
BEGIN
  DELETE FROM originality_texts WHERE submission_id = OLD.id;
END;
