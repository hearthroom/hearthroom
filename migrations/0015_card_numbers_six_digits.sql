-- 卡號改成固定 6 位數、從 100001 起跳（owner 2026-09-17）。
--
-- 從 1 遞增有三個問題：#21 看起來像頁碼不像編號；每張新卡都在公開本站有幾張卡；
-- 1 位、2 位、3 位的過渡期長度不齊。6 位數可以用到 90 萬張都不變寬。
-- 已發出去的號（上線一個多小時，二十幾個）照原順序整批平移，不重排、不重發；
-- 序號表一併推到 100000，下一張就是 100001（空表也一樣）。

UPDATE card_numbers SET num = num + 100000 WHERE num < 100000;

-- sqlite_sequence 沒有唯一鍵，INSERT OR REPLACE 只會多塞一列；要先改既有列、沒有才新增。
UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(num), 100000) FROM card_numbers) WHERE name = 'card_numbers';
INSERT INTO sqlite_sequence (name, seq)
SELECT 'card_numbers', (SELECT COALESCE(MAX(num), 100000) FROM card_numbers)
WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'card_numbers');
