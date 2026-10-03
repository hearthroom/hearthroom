-- 搜尋索引分成三欄：search_name（名稱）、search_text（簡介、標籤、作者名）、search_body（開場白），
-- 相關度排序才能把名字命中的卡排在簡介命中的前面、再排在只有開場白提到的前面。
-- 三欄從這版起都存正規化後的字（全半形統一、日文新字體與繁體→簡體、小寫、去標點），查詢端同樣正規化，
-- 繁簡、大小寫、標點因此互通。
-- 既有列的 search_text 仍是舊的混合原文、search_name 是空的，下一輪每小時同步會逐張重寫。
ALTER TABLE cards ADD COLUMN search_name TEXT NOT NULL DEFAULT '';
ALTER TABLE cards ADD COLUMN search_body TEXT NOT NULL DEFAULT '';

DROP TRIGGER cards_fts_ai;
DROP TRIGGER cards_fts_ad;
DROP TRIGGER cards_fts_au;
DROP TABLE cards_fts;

-- trigram tokenizer：unicode61 不切中日韓詞；代價是每個查詢詞要 >= 3 字元，更短的由 cards.ts 走 LIKE。
CREATE VIRTUAL TABLE cards_fts USING fts5(
  search_name,
  search_text,
  search_body,
  content='cards',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts(rowid, search_name, search_text, search_body) VALUES (new.rowid, new.search_name, new.search_text, new.search_body);
END;

CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, search_name, search_text, search_body) VALUES ('delete', old.rowid, old.search_name, old.search_text, old.search_body);
END;

-- 只在可搜尋欄位變動時重寫索引；每小時同步只更新計數時不該引發 FTS 重建。
CREATE TRIGGER cards_fts_au AFTER UPDATE OF search_name, search_text, search_body ON cards BEGIN
  INSERT INTO cards_fts(cards_fts, rowid, search_name, search_text, search_body) VALUES ('delete', old.rowid, old.search_name, old.search_text, old.search_body);
  INSERT INTO cards_fts(rowid, search_name, search_text, search_body) VALUES (new.rowid, new.search_name, new.search_text, new.search_body);
END;

INSERT INTO cards_fts(rowid, search_name, search_text, search_body) SELECT rowid, search_name, search_text, search_body FROM cards;

-- 過審時把這一版的三欄索引字投影到卡上（public_role 裡的 searchName／searchText／searchBody 由 hosting.ts 在封存時算好）。
-- 舊版本的 public_role 沒有 searchName／searchBody：COALESCE 留住原值，等同步重寫。
DROP TRIGGER hosting_review_search;
CREATE TRIGGER hosting_review_search AFTER UPDATE OF status ON review_submissions
WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE cards SET
  search_name=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchName'),search_name),
  search_text=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchText'),search_text),
  search_body=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchBody'),search_body),
  slug=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.slug')
 WHERE id=NEW.card_id;
END;
