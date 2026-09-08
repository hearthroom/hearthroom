-- 成人內容標記（owner 2026-09-08）。
--
-- 這是本站自己的分級，不讀供應商的：作者提交時自己宣告，審核人對照內容，不符就駁回；
-- 預設全站不展示，成員要在設定裡開啟、且先驗過年齡才看得到。
-- 宣告記在審核單上（提交當下那一版宣告了什麼），過審後的結果記在卡片上。
-- 年齡只記「驗過的時間」，不存生日：本站對一個人存的東西維持最少。
ALTER TABLE cards ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0;
ALTER TABLE review_submissions ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN show_nsfw INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN age_verified_at INTEGER;
