-- 語區。
--
-- 每張卡在來源那邊都標了主要語言；讀者要的是「我看得懂的卡」，把四種語言混在
-- 同一個榜單上，對每個人來說都有四分之三是雜訊。所以榜單按語區分開列，
-- 不做跨語區的總榜。
--
-- 值只有五種：zh / en / ja / ko / all。簡繁體併成一個 zh——同一批讀者兩種都看得懂，
-- 拆成兩區只會讓每區都更空。all 是來源標成「不分語言」的卡，每一區都會列出來。
--
-- 預設 all 而不是空字串：加欄位之前登記的卡在下一輪同步補上正確語區之前，
-- 寧可暫時在每一區都看得到，也不要憑空從所有榜單消失。
ALTER TABLE cards ADD COLUMN zone TEXT NOT NULL DEFAULT 'all';

-- 三種排序各配一個以語區開頭的索引，分區之後排序仍然走索引掃描。
-- ponytail: 查詢是 zone IN (?, 'all')，SQLite 對每個值各掃一段再合併排序；
-- 語區內的卡量到十萬級之前這個成本看不見，到了再考慮把 all 展開寫進各區。
CREATE INDEX idx_cards_zone_hot  ON cards (zone, hot_score DESC, registered_at DESC);
CREATE INDEX idx_cards_zone_new  ON cards (zone, registered_at DESC);
CREATE INDEX idx_cards_zone_talk ON cards (zone, talk_num DESC, follow_num DESC);
