-- Claims prevent cross-device or concurrent first-conversion duplication.
CREATE TABLE analytics_milestones (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK(event IN ('sign_up', 'first_chat')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, event)
);
