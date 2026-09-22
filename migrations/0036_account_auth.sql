-- OAuth credentials belong to the community account, never a browser profile.
CREATE TABLE account_auth_clients (
 origin TEXT NOT NULL, provider TEXT NOT NULL, scope TEXT NOT NULL,
 client_id TEXT NOT NULL, PRIMARY KEY(origin,provider,scope)
);
CREATE TABLE account_auth_attempts (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, origin TEXT NOT NULL,
 provider TEXT NOT NULL, source_session TEXT, payload TEXT NOT NULL,
 phase TEXT NOT NULL DEFAULT 'code', expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX account_auth_attempt_browser ON account_auth_attempts(browser_hash);
CREATE INDEX account_auth_attempt_expiry ON account_auth_attempts(expires_at);
CREATE TABLE account_sessions (
 token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL,
 provider TEXT NOT NULL, external_id TEXT NOT NULL,
 origin TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX account_session_expiry ON account_sessions(expires_at);
CREATE TABLE account_credentials (
 provider TEXT NOT NULL, external_id TEXT NOT NULL, generation TEXT NOT NULL UNIQUE,
 payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', expires_at INTEGER NOT NULL,
 refresh_started INTEGER, updated_at INTEGER NOT NULL,
 PRIMARY KEY(provider,external_id)
);
-- Revocation is generation-specific: reconnecting cannot resurrect an old queued token.
CREATE TABLE account_auth_revocations (
 generation TEXT PRIMARY KEY, provider TEXT NOT NULL, payload TEXT NOT NULL,
 retry_at INTEGER NOT NULL
);
CREATE INDEX account_auth_revocation_retry ON account_auth_revocations(retry_at);
CREATE TABLE account_auth_metrics (
 operation TEXT NOT NULL, provider TEXT NOT NULL, outcome TEXT NOT NULL,
 value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(operation,provider,outcome)
);
