-- 作者主頁的關注／粉絲可見度（取代 show_stats；作品數與被聊過一律公開）。
-- following_visibility：list＝他人可看數字並打開名單；count＝只有數字；hidden＝不公開數字。
-- followers_visibility：list／count（粉絲數一律公開）。
-- 預設 count／count：名單是新暴露的資料，現有成員沒選過，不替他們公開（任務 2026-11-19-profile-visibility §2）。
-- 舊的 show_stats 不論真假都落在預設值，不另回填。欄位本身等新版上線後再刪（舊版 Worker 在遷移與部署之間仍會讀它）。
ALTER TABLE members ADD COLUMN following_visibility TEXT NOT NULL DEFAULT 'count' CHECK(following_visibility IN ('list','count','hidden'));
ALTER TABLE members ADD COLUMN followers_visibility TEXT NOT NULL DEFAULT 'count' CHECK(followers_visibility IN ('list','count'));

-- 粉絲名單依關注時間新到舊分頁；涵蓋原本只按 author_id 的索引。
CREATE INDEX member_follows_author_recent ON member_follows(author_id, created_at DESC);
DROP INDEX IF EXISTS member_follows_author;
