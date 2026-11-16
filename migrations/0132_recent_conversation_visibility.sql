-- Private list visibility only. Provider messages and the resume pointer remain intact.
CREATE TABLE member_conversation_hides (
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('lunatalk','harbor')),
 role_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 pointer_updated_at INTEGER NOT NULL,
 PRIMARY KEY(member_id,provider,role_id,conversation_id)
);
