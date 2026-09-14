-- 不想看的類型（owner 2026-09-14）。
--
-- 每個成員自己勾掉幾個類型，榜單與搜尋就不再出現那些卡；不分頁、不分區，首頁還是一個池子，
-- 只是每個人自己拉窗簾。存的是類型目錄的鍵（shared/tag-catalog.ts），JSON 陣列、排序去重；
-- 過濾發生在榜單查詢裡（?hide=），不是畫面上事後挑掉，分頁與總數才對得上。
ALTER TABLE members ADD COLUMN hidden_tags TEXT NOT NULL DEFAULT '[]';
