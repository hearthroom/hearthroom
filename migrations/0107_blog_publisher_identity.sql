-- Private studio publisher: an audit-only member, never an OAuth identity or reviewer.
-- Refuse to adopt an existing account or a reserved member that gained login/admin links.
CREATE TABLE _blog_publisher_identity_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _blog_publisher_identity_guard (ok)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM members WHERE id = 'system-blog-publisher' AND (handle <> 'sukiblog' OR display_name IS NOT '蘇綺'))
  OR EXISTS (SELECT 1 FROM member_identities WHERE member_id = 'system-blog-publisher')
  OR EXISTS (SELECT 1 FROM member_connections WHERE owner_member_id = 'system-blog-publisher')
  OR EXISTS (SELECT 1 FROM reviewers WHERE member_id = 'system-blog-publisher')
  OR EXISTS (SELECT 1 FROM review_agents WHERE member_id = 'system-blog-publisher')
THEN 0 ELSE 1 END;

INSERT INTO members (id, handle, display_name, created_at, show_stats)
VALUES ('system-blog-publisher', 'sukiblog', '蘇綺', unixepoch() * 1000, 0)
ON CONFLICT(id) DO NOTHING;

INSERT INTO audit_log (id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, before_json, after_json, operation_id, created_at)
VALUES ('system-blog-publisher-created', 'member', 'system-blog-publisher', NULL, 'system', 'blog_publisher_identity_create', 'Dedicated studio blog audit identity; no login or reviewer privileges', '{}', '{"handle":"sukiblog","displayName":"蘇綺","loginIdentity":false,"reviewer":false}', 'system-blog-publisher-created', unixepoch() * 1000)
ON CONFLICT(id) DO NOTHING;
DROP TABLE _blog_publisher_identity_guard;
