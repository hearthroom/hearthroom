-- Keep completed receipts when another tab starts a transfer. Preserve 0079 for
-- local databases that already applied the initial feature migration.
CREATE TABLE account_route_handoffs_next (
 request_hash TEXT PRIMARY KEY,
 source_session TEXT NOT NULL,
 source_browser TEXT NOT NULL,
 source_origin TEXT NOT NULL,
 target_origin TEXT NOT NULL,
 return_to TEXT NOT NULL,
 target_browser TEXT,
 code_hash TEXT UNIQUE,
 consumed_session TEXT,
 expires_at INTEGER NOT NULL
);
INSERT INTO account_route_handoffs_next SELECT * FROM account_route_handoffs;
DROP TABLE account_route_handoffs;
ALTER TABLE account_route_handoffs_next RENAME TO account_route_handoffs;
CREATE INDEX account_route_handoff_expiry ON account_route_handoffs(expires_at);
CREATE UNIQUE INDEX account_route_handoff_active ON account_route_handoffs(source_session) WHERE consumed_session IS NULL;
CREATE INDEX account_route_handoff_source ON account_route_handoffs(source_session);
