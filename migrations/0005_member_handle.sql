-- 成員的公開 ID（owner 2026-09-08）。
--
-- 對外只露這個，不露上游的數字 ID：作者頁的網址、「我的」頁顯示的 ID 都是它。
-- 一個成員之後可能在多家供應商上發布，公開 ID 必須是本站自己發的，再透過 member_identities
-- 映射到各家的公開 ID。內部主鍵（members.id）不動，審核人、領取、蓋章都掛在它上面。
--
-- 8 個小寫字母、隨機。不用數字：流水號會透露站台規模，也跟舊網址的數字 ID 混在一起。
ALTER TABLE members ADD COLUMN handle TEXT NOT NULL DEFAULT '';

-- 既有成員補一個。random() 每次呼叫都重新取值，八個 substr 各自獨立；& 2147483647 而不是 abs()
-- （abs(random()) 在最小負值會溢位）。碰撞機率 27 人裡可忽略，唯一索引擋住萬一。
UPDATE members SET handle =
  substr('abcdefghijklmnopqrstuvwxyz', (random() & 2147483647) % 26 + 1, 1) ||
  substr('abcdefghijklmnopqrstuvwxyz', (random() & 2147483647) % 26 + 1, 1) ||
  substr('abcdefghijklmnopqrstuvwxyz', (random() & 2147483647) % 26 + 1, 1) ||
  substr('abcdefghijklmnopqrstuvwxyz', (random() & 2147483647) % 26 + 1, 1) ||
  substr('abcdefghijklmnopqrstuvwxyz', (random() & 2147483647) % 26 + 1, 1) ||
  substr('abcdefghijklmnopqrstuvwxyz', (random() & 2147483647) % 26 + 1, 1) ||
  substr('abcdefghijklmnopqrstuvwxyz', (random() & 2147483647) % 26 + 1, 1) ||
  substr('abcdefghijklmnopqrstuvwxyz', (random() & 2147483647) % 26 + 1, 1)
WHERE handle = '';

CREATE UNIQUE INDEX idx_members_handle ON members (handle);
