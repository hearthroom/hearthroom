CREATE TABLE works (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL, source_provider TEXT NOT NULL,
 source_role_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(source_provider, source_role_id)
);
CREATE TABLE work_copies (
 work_id TEXT NOT NULL, provider TEXT NOT NULL, external_id INTEGER NOT NULL,
 role_id TEXT, source_hash TEXT NOT NULL DEFAULT '', target_hash TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'missing', error TEXT NOT NULL DEFAULT '',
 operation TEXT, updated_at INTEGER NOT NULL,
 PRIMARY KEY(work_id, provider), UNIQUE(provider, role_id)
);
