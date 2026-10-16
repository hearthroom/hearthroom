-- 輕量分享每人上限（owner 2026-10-17：輕量分享一筆就給積分，不設上限的話會有人找一堆群發）。
-- NULL＝不限。一個人在同一個活動裡、申請或核准為輕量、還沒被拒的位置，最多這麼多個；其他檔位不受影響。
-- 綺夢分享季照 owner 的裁決設 10；之後的活動在後台設定。
ALTER TABLE campaigns ADD COLUMN light_limit INTEGER CHECK (light_limit IS NULL OR light_limit >= 1);
UPDATE campaigns SET light_limit = 10 WHERE slug = 'share-season';
