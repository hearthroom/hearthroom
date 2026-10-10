-- 卡片分級改成作者自評問卷（owner 2026-10-10）：一般／成人二選一換成台灣遊戲分級的五級。
-- 設計稿：docs/technical-design/HearthroomContentRatingSelfAssessment_TechnicalDesign_20261010_V0.1.md
--
-- rating：G／P／PG12／PG15／R（普遍／保護／輔12／輔15／限制級）。NULL＝評級缺失：
--   這之前上架的一般卡，只知道不是成人卡，不知道是哪一級。它們照樣在一般區，
--   作者下次送審時一定要補問卷（POST /v1/cards 不收沒有問卷的提交）。
-- rating_descriptors：情節名稱（JSON 陣列），卡片頁照法規第 12 條標示。
-- rating_answers：作者的問卷答案（JSON），審核頁對照內容看；hosting_versions 也存一份，給同一個 operation 重試時比對。
--
-- 舊的成人旗標 nsfw 要拿掉（owner 2026-10-11：舊欄位是重複的歷史包袱，全部換成新欄位）。
-- 「成人內容」從此就是 rating = 'R'：成人卡搬成限制級，其餘留 NULL。
-- 分兩次上線（同 0038／0039）：部署是先跑 migration 再換 Worker，這一支只加新欄位、搬資料、重建 trigger，
-- 舊 Worker 在換版前那段時間仍讀得到 nsfw；0057 等新 Worker 全面上線後才刪欄位。
-- hosting_versions 與 moderation_cases 的 nsfw 是 NOT NULL 沒有預設值，刪欄位前新 Worker 照樣寫入它。
-- 成員的 show_nsfw（看的人要不要看成人內容）是另一件事，不動。

ALTER TABLE review_submissions ADD COLUMN rating TEXT;
ALTER TABLE review_submissions ADD COLUMN rating_descriptors TEXT;
ALTER TABLE review_submissions ADD COLUMN rating_answers TEXT;
ALTER TABLE hosting_versions ADD COLUMN rating TEXT;
ALTER TABLE hosting_versions ADD COLUMN rating_answers TEXT;
ALTER TABLE cards ADD COLUMN rating TEXT;
ALTER TABLE cards ADD COLUMN rating_descriptors TEXT;
ALTER TABLE moderation_cases ADD COLUMN rating TEXT;

UPDATE cards SET rating='R' WHERE nsfw=1;
UPDATE review_submissions SET rating='R' WHERE nsfw=1;
UPDATE hosting_versions SET rating='R' WHERE nsfw=1;
UPDATE moderation_cases SET rating='R' WHERE nsfw=1;

-- 提前做好的評測：卡片第一次送審前還不在 cards 表，所以草稿以作者＋上游卡片 ID 為鍵。
CREATE TABLE rating_drafts (
  member_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  role_id TEXT NOT NULL,
  answers TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, provider, role_id)
);

-- 引用 nsfw 的四個觸發器照目前生效的定義重建，只把 nsfw 換成 rating；之後才能刪欄位。
DROP TRIGGER board_cache_visibility;
CREATE TRIGGER board_cache_visibility AFTER UPDATE OF status, rating, approved_version_id ON cards
WHEN NEW.status IS NOT OLD.status OR NEW.rating IS NOT OLD.rating
  OR NEW.approved_version_id IS NOT OLD.approved_version_id
BEGIN
  UPDATE moderation_clock SET revision=revision+1 WHERE id=1;
END;

DROP TRIGGER hosting_review_immutable;
CREATE TRIGGER hosting_review_immutable BEFORE UPDATE ON review_submissions
WHEN OLD.content_hash LIKE 'version:%' AND (
 NEW.content_hash<>OLD.content_hash OR NEW.rating IS NOT OLD.rating OR
 NEW.card_id<>OLD.card_id OR NEW.source_role_id<>OLD.source_role_id OR NEW.kind<>OLD.kind
)
BEGIN SELECT RAISE(ABORT,'hosted_revision_immutable'); END;

DROP TRIGGER review_delivery_update;
CREATE TRIGGER review_delivery_update AFTER UPDATE OF status,claimed_by,claimed_at,claim_generation,rating,content_hash ON review_submissions BEGIN
 UPDATE review_deliveries SET revision=revision+1,due_at=0,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE submission_id=NEW.id;
END;

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
  rating=NEW.rating,
  rating_descriptors=NEW.rating_descriptors,
  zone=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.zone'),
  names=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.names'),
  summaries=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.summaries'),
  background_url=COALESCE(NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.backgroundUrl'),''),json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.avatarUrl')),
  share_image_url=NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.shareImageUrl'),''),
  landscape_url=NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.backgroundLandscapeUrl'),''),
  tags=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.tags')
 WHERE id=NEW.card_id AND NEW.status='approved';
END;

