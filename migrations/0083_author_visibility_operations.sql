-- Whole author commands remain pending until both Provider and D1 finish.
-- No bearer or private configuration is persisted for recovery.
CREATE TABLE author_visibility_operations (
 member_id TEXT NOT NULL REFERENCES members(id),
 operation_id TEXT NOT NULL,
 source_role_id TEXT NOT NULL,
 work_id TEXT NOT NULL REFERENCES works(id),
 provider_operation_id TEXT NOT NULL,
 intent TEXT NOT NULL,
 command TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','complete','conflict')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(member_id,operation_id),
 UNIQUE(work_id,provider_operation_id)
);
CREATE INDEX author_visibility_pending ON author_visibility_operations(state,updated_at);
