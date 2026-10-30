-- 留言改成先發布、後審核（owner 2026-10-30）：命中規則的留言照常公開，只在 hold_reason 記原因進待審。
-- 'held' 狀態從此不再寫入；CHECK 約束留著（SQLite 改約束要重建整張表，不值得）。
-- 殘留的待審留言一律轉公開、保留原因。上線前正式站盤點為 0 筆；有的話，獎勵另行補報（見任務書）。

-- 先補回覆數：待審的回覆當時沒算進頂層。
UPDATE comments SET reply_count = reply_count + (SELECT COUNT(*) FROM comments r WHERE r.root_id = comments.id AND r.status = 'held')
WHERE root_id IS NULL AND EXISTS (SELECT 1 FROM comments r WHERE r.root_id = comments.id AND r.status = 'held');

-- 轉公開時 community_comment_reply_release 還在，被回覆的人照放行的方式收到通知。
UPDATE comments SET status = 'visible' WHERE status = 'held';

DROP TRIGGER IF EXISTS community_comment_reply_release;
DROP INDEX IF EXISTS idx_comments_held;
CREATE INDEX idx_comments_flagged ON comments(created_at) WHERE status = 'visible' AND hold_reason IS NOT NULL;
