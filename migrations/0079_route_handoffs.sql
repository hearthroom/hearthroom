-- Browser-bound transfers contain hashes, never OAuth or raw session tokens.
CREATE TABLE account_route_handoffs (
 request_hash TEXT PRIMARY KEY,
 source_session TEXT NOT NULL UNIQUE,
 source_browser TEXT NOT NULL,
 source_origin TEXT NOT NULL,
 target_origin TEXT NOT NULL,
 return_to TEXT NOT NULL,
 target_browser TEXT,
 code_hash TEXT UNIQUE,
 consumed_session TEXT,
 expires_at INTEGER NOT NULL
);
CREATE INDEX account_route_handoff_expiry ON account_route_handoffs(expires_at);
-- A transferred browser family is separate from other devices of the same member.
CREATE TABLE account_route_families (
 token_hash TEXT PRIMARY KEY,
 family_hash TEXT NOT NULL
);
CREATE INDEX account_route_family ON account_route_families(family_hash);
