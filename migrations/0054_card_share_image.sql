-- 分享圖：作者畫的 1.91:1（1200×630）連結預覽圖，選填。卡片頁的 og:image 先用它；沒有才用直式封面合成（src/index.ts /og/cards）。
-- 直式封面直接當 og:image 的話，Discord／LINE／X 從中間裁 1.91:1，作者畫在圖上的標題常被切掉。
--
-- 跟其他公開欄位一樣跟著過審那一版走：封存時 hosting.ts 把供應商的 roleShareImage 寫進 public_role 的 shareImageUrl，
-- 過審時下面的 trigger 抄到卡上；同步讀過審的封存版時也帶上（cards.ts syncStatement）。
-- 新的一版沒有分享圖就清成 NULL，不殘留上一版的。0054 之前封存的版本 public_role 裡沒有這個鍵，抄到的是 NULL。
ALTER TABLE cards ADD COLUMN share_image_url TEXT;

-- hosting_decision 照 0038 的定義重建（目前生效的那一版），只多 share_image_url 一行。
DROP TRIGGER hosting_decision;
CREATE TRIGGER hosting_decision AFTER UPDATE OF status ON review_submissions
WHEN NEW.status IN ('approved','rejected') AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE hosting_versions SET state=NEW.status WHERE submission_id=NEW.id;
 UPDATE cards SET status='approved'
 WHERE id=NEW.card_id AND approved_version_id IS NOT NULL;
 UPDATE cards SET
  approved_version_id=(SELECT version_id FROM hosting_versions WHERE submission_id=NEW.id),
  approved_hosted_role_id=(SELECT hosted_revision_id FROM hosting_versions WHERE submission_id=NEW.id),
  nsfw=NEW.nsfw,
  zone=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.zone'),
  names=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.names'),
  summaries=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.summaries'),
  background_url=COALESCE(NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.backgroundUrl'),''),json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.avatarUrl')),
  share_image_url=NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.shareImageUrl'),''),
  tags=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.tags')
 WHERE id=NEW.card_id AND NEW.status='approved';
END;
