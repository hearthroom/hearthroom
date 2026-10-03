-- 原作（fandom）：這張卡改編或致敬的作品，作者送審時宣告、審核人可改。
-- fandom 是作者寫的原文；fandom_key 是它的搜尋正規形（繁→簡、小寫、去標點），篩選與分組都用 key，
-- 「刀劍神域」「刀剑神域」才會是同一個原作。兩個值在封存時算好放進 public_role，過審時由下面的 trigger 投影到卡上；
-- 版本裡沒有這個鍵（舊版本）時 COALESCE 留住原值。
ALTER TABLE cards ADD COLUMN fandom TEXT NOT NULL DEFAULT '';
ALTER TABLE cards ADD COLUMN fandom_key TEXT NOT NULL DEFAULT '';
CREATE INDEX cards_fandom_key ON cards(fandom_key);

DROP TRIGGER hosting_review_search;
CREATE TRIGGER hosting_review_search AFTER UPDATE OF status ON review_submissions
WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE cards SET
  search_name=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchName'),search_name),
  search_text=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchText'),search_text),
  search_body=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchBody'),search_body),
  fandom=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.fandom'),fandom),
  fandom_key=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.fandomKey'),fandom_key),
  slug=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.slug')
 WHERE id=NEW.card_id;
END;
