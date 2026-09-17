-- 原成員、身分與歷史保留；只以可解除的關聯選定顯示成員。
CREATE UNIQUE INDEX uniq_member_provider ON member_identities(member_id, provider);
CREATE TABLE member_connections (
 provider TEXT NOT NULL, external_id TEXT NOT NULL, owner_member_id TEXT NOT NULL,
 linked_at INTEGER NOT NULL, PRIMARY KEY(provider,external_id), UNIQUE(owner_member_id,provider)
);
