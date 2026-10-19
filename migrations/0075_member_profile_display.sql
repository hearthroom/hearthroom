-- 主頁封面與數據開關（owner 2026-10-19）
-- cover：站內場景圖的 id（shared/profile-covers.ts），空字串＝沒選過、畫面用預設那張
-- show_stats：自己的主頁要不要顯示作品數、被對話、粉絲、關注；預設關
ALTER TABLE members ADD COLUMN cover TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN show_stats INTEGER NOT NULL DEFAULT 0 CHECK(show_stats IN (0,1));
-- 作者頁快照跟著封面失效（同 0032 的 public_profile_revision）
CREATE TRIGGER public_profile_cover_revision AFTER UPDATE OF cover ON members
WHEN OLD.cover IS NOT NEW.cover BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.id;
END;
