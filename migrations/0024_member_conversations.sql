-- Community-owned recent sessions; no imported provider library or message bodies.
CREATE TABLE member_conversations (
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('lunatalk','harbor')),
 role_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(member_id, provider, role_id)
);
CREATE INDEX member_conversations_recent ON member_conversations(member_id, updated_at DESC);
