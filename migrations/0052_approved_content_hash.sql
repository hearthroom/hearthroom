-- 已發布的卡，作者之後改了卻沒送審：「我的卡片」要標出來（owner 2026-10-05：改了忘記提交，自己都不知道）。
--
-- 比的是供應商的內容版本（Harbor 的 role.content_hash：設定、各語區名稱／簡介／說明／開場白、直式與橫式封面；
-- 世界書與作者規則不在裡面）。封存版是送審當下的複本，雜湊照抄，所以「過審那一版的雜湊」＝封存版的雜湊；
-- 草稿現在的雜湊由「我的卡片」的上游清單帶回來，兩個不同就是有修改還沒送審。
--
-- 這一欄只記過審那一版的雜湊，跟 approved_version_id 一起換：
-- - 新的一版過審時（hosting_decision 改了 approved_version_id），從那一版封存時記下的 public_role 抄過來；
--   0052 之前封存的版本 public_role 裡沒有這個值，抄到的是 NULL。
-- - 同步讀的就是過審的封存版（approved_hosted_role_id），順手補上——舊卡在同步輪到它時補齊，不另跑腳本。
-- NULL 表示還不知道：清單不標，不猜。
ALTER TABLE cards ADD COLUMN approved_content_hash TEXT;

CREATE TRIGGER cards_approved_content_hash AFTER UPDATE OF approved_version_id ON cards
WHEN NEW.approved_version_id IS NOT OLD.approved_version_id
BEGIN
 UPDATE cards SET approved_content_hash=(
  SELECT json_extract(public_role,'$.contentHash') FROM hosting_versions WHERE version_id=NEW.approved_version_id
 ) WHERE id=NEW.id;
END;
