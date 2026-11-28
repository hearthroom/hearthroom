-- Effective delists and immediate suspensions remain relevant after restoration.
CREATE INDEX moderation_human_review_history ON moderation_cases(provider, source_role_id)
WHERE action='suspend' OR (action='delist' AND status='confirmed');
