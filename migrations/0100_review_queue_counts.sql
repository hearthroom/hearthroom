-- 審核清單每列顯示世界書條目數與正規表示式規則數（owner 2026-11-02）。跟字數一樣送審時記在審核單上，
-- 佇列不必逐張解壓審核副本。口徑：所有世界書的全部條目、作者資產的全部規則，含停用
-- （與審核頁「成本側寫」的條目總數、「正規表示式與版面」的規則數相同）。
-- NULL＝不知道（這一版之前送的單、同步開的重審單）；審核頁讀到完整設定時補記。
ALTER TABLE review_submissions ADD COLUMN review_worldbook_entries INTEGER;
ALTER TABLE review_submissions ADD COLUMN review_regex_rules INTEGER;
