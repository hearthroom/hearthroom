-- Award only durable, completed approvals; imported/unreviewed cards do not qualify.
-- Existing awards remain authoritative and retries cannot duplicate an award.
INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
SELECT o.member_id,'first_work',o.work_id,r.decided_at
FROM review_submissions r JOIN community_card_owners o ON o.card_id=r.card_id
WHERE r.status='approved' AND r.decided_at IS NOT NULL AND o.member_id IS NOT NULL
ORDER BY r.decided_at,r.id;
