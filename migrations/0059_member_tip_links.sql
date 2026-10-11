-- 作者的打賞連結（shared/tip-links.ts）：標準網址的 JSON 陣列，作者頁與卡片頁的作者區塊讀它。
ALTER TABLE members ADD COLUMN tip_links TEXT NOT NULL DEFAULT '[]';
-- 作者頁走公開快照，鍵裡有 public_cache_revision；打賞連結改了也要換版，不然要等快照過期才看得到。
DROP TRIGGER IF EXISTS public_profile_revision;
CREATE TRIGGER public_profile_revision AFTER UPDATE OF handle,display_name,avatar_url,bio,tip_links ON members
WHEN OLD.handle IS NOT NEW.handle OR OLD.display_name IS NOT NEW.display_name OR OLD.avatar_url IS NOT NEW.avatar_url OR OLD.bio IS NOT NEW.bio OR OLD.tip_links IS NOT NEW.tip_links BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.id;
END;
