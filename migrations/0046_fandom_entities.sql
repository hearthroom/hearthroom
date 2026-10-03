-- 原作改以 Wikidata 編號為準（owner 2026-10-03：站方不維護目錄）。
-- fandom_entities 是選定過的作品在本站的副本：各語言正式名、別名、說明，選定時抓一次，之後顯示與搜尋都不再問對方。
-- cards.fandom_qid 有值時 fandom_key 是 'wd:'+qid，各地譯名、縮寫都落到同一個鍵；沒對到編號的照打的字當自由文字（待歸類）。
CREATE TABLE fandom_entities (
 qid TEXT PRIMARY KEY,
 labels TEXT NOT NULL,
 aliases TEXT NOT NULL,
 descriptions TEXT NOT NULL,
 search_text TEXT NOT NULL,
 fetched_at INTEGER NOT NULL
);
ALTER TABLE cards ADD COLUMN fandom_qid TEXT REFERENCES fandom_entities(qid);
CREATE INDEX cards_fandom_qid ON cards(fandom_qid);
-- 站方過審後改原作：跟 tags_override 同一個位置，JSON {fandom, qid, key, search}；再過審時這個優先於作者那一版。
ALTER TABLE moderation_state ADD COLUMN fandom_override TEXT;

DROP TRIGGER hosting_review_search;
CREATE TRIGGER hosting_review_search AFTER UPDATE OF status ON review_submissions
WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE cards SET
  search_name=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchName'),search_name),
  search_text=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchText'),search_text),
  search_body=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchBody'),search_body),
  fandom=COALESCE((SELECT json_extract(fandom_override,'$.fandom') FROM moderation_state m WHERE m.provider=cards.provider AND m.source_role_id=cards.source_role_id),json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.fandom'),fandom),
  fandom_key=COALESCE((SELECT json_extract(fandom_override,'$.key') FROM moderation_state m WHERE m.provider=cards.provider AND m.source_role_id=cards.source_role_id),json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.fandomKey'),fandom_key),
  fandom_qid=CASE WHEN (SELECT fandom_override FROM moderation_state m WHERE m.provider=cards.provider AND m.source_role_id=cards.source_role_id) IS NOT NULL
    THEN (SELECT json_extract(fandom_override,'$.qid') FROM moderation_state m WHERE m.provider=cards.provider AND m.source_role_id=cards.source_role_id)
    WHEN json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.fandomKey') IS NOT NULL
    THEN json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.fandomQid')
    ELSE fandom_qid END,
  slug=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.slug')
 WHERE id=NEW.card_id;
END;
