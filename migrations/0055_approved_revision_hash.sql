-- 「改了沒送審」也要看得出只改了顯示規則或世界書的修改（owner 2026-10-08：只改了規則，我的卡片沒標、卡片頁也沒說，
-- 試玩到的還是過審那一版）。0052 的 approved_content_hash 比的 Harbor content_hash 不含作者規則與世界書；
-- Harbor 的卡片詳情另給 revisionHash（content_hash 再加作者規則與綁定世界書的條目，不算任何 id，封存版與送審當下的草稿相同）。
--
-- 這一欄跟 approved_content_hash 一樣只記過審那一版，換的時機也一樣：新版過審時從封存時記下的 public_role 抄，
-- 同步讀到過審的封存版時補齊（這一欄之前過審的卡靠同步補）。NULL 表示還不知道：退回只比 approved_content_hash。
ALTER TABLE cards ADD COLUMN approved_revision_hash TEXT;

CREATE TRIGGER cards_approved_revision_hash AFTER UPDATE OF approved_version_id ON cards
WHEN NEW.approved_version_id IS NOT OLD.approved_version_id
BEGIN
 UPDATE cards SET approved_revision_hash=(
  SELECT json_extract(public_role,'$.revisionHash') FROM hosting_versions WHERE version_id=NEW.approved_version_id
 ) WHERE id=NEW.id;
END;
