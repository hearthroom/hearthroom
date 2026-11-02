-- 審核工具第一批（2026-11-02）：送審當下的有效字數記在審核單上。
-- 佇列要顯示每張卡的字數、蓋章要擋未達標的通過；字數原本只在壓縮過的審核副本裡，
-- 佇列一次列兩百張不該逐張解壓。門檻（REVIEW_REQUIRED_CHARACTERS）不存：達標與否讀的時候算，
-- 門檻改了不用回頭改資料。
-- NULL＝不知道：門檻上線前送的單、同步開的重審單（沒有私有設定）。審核頁讀到完整設定算出來時補記。
ALTER TABLE review_submissions ADD COLUMN review_length_total INTEGER;
