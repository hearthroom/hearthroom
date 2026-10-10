-- 舊的成人旗標 nsfw 刪除（owner 2026-10-11）。0056 已把成人卡搬成 rating = 'R'、引用它的 trigger 改用 rating 重建，
-- 這一支要等 0056 那一版 Worker 全面上線後才上（同 0038／0039 的兩段式）：之後的 Worker 不再讀寫它。
-- 成員的 show_nsfw（看的人要不要看成人內容）是另一件事，不動。
ALTER TABLE cards DROP COLUMN nsfw;
ALTER TABLE review_submissions DROP COLUMN nsfw;
ALTER TABLE hosting_versions DROP COLUMN nsfw;
ALTER TABLE moderation_cases DROP COLUMN nsfw;
