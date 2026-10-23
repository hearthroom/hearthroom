-- Additive and opt-in. A work is enrolled only after trusted issuer readback;
-- legacy works are not inferred from the source draft's visibility.
CREATE TABLE managed_work_access (
 work_id TEXT PRIMARY KEY REFERENCES works(id),
 provider TEXT NOT NULL,
 source_role_id TEXT NOT NULL,
 access TEXT NOT NULL CHECK(access IN ('private','unlisted','public')),
 epoch INTEGER NOT NULL CHECK(epoch>=0),
 restriction TEXT NOT NULL CHECK(restriction IN ('none','delisted','suspended')),
 approved_role_id TEXT,
 sync_state TEXT NOT NULL DEFAULT 'complete' CHECK(sync_state IN ('complete','changing')),
 sync_operation_id TEXT,
 UNIQUE(provider,source_role_id)
);
CREATE TABLE visibility_operations (
 work_id TEXT NOT NULL REFERENCES works(id),
 operation_id TEXT NOT NULL,
 root_operation_id TEXT NOT NULL,
 command TEXT NOT NULL,
 intent_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('intent','pending','complete','conflict')),
 receipt TEXT,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(work_id,operation_id)
);
CREATE INDEX visibility_pending ON visibility_operations(state,updated_at);
CREATE TABLE work_publication_permits (
 version_id TEXT PRIMARY KEY REFERENCES hosting_versions(version_id),
 operation_id TEXT NOT NULL UNIQUE,
 epoch INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','published','cancelled','conflict')),
 published_epoch INTEGER
);
CREATE TABLE work_review_decisions (
 submission_id TEXT PRIMARY KEY REFERENCES review_submissions(id),
 decided_at INTEGER NOT NULL
);
-- A review decision cannot itself grant publication, notify followers or award
-- first publication. Only a Provider-committed permit can enter existing triggers.
CREATE TRIGGER managed_review_publication BEFORE UPDATE OF status ON review_submissions
WHEN NEW.status='approved' AND EXISTS(
 SELECT 1 FROM hosting_versions v JOIN managed_work_access p ON p.work_id=v.work_id WHERE v.submission_id=NEW.id)
 AND NOT EXISTS(
 SELECT 1 FROM hosting_versions v JOIN work_publication_permits g ON g.version_id=v.version_id
 JOIN managed_work_access p ON p.work_id=v.work_id
 WHERE v.submission_id=NEW.id AND g.state='published' AND p.sync_state='complete'
 AND p.epoch=g.published_epoch AND p.access='public' AND p.approved_role_id=v.hosted_revision_id)
BEGIN SELECT RAISE(ABORT,'publication_not_committed'); END;
CREATE TRIGGER managed_card_publication BEFORE UPDATE OF status,approved_hosted_role_id ON cards
WHEN NEW.status='approved' AND (OLD.status IS NOT NEW.status OR OLD.approved_hosted_role_id IS NOT NEW.approved_hosted_role_id)
 AND EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=NEW.provider AND p.source_role_id=NEW.source_role_id)
 AND NOT EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=NEW.provider AND p.source_role_id=NEW.source_role_id
 AND p.sync_state='complete' AND p.access='public' AND p.approved_role_id=NEW.approved_hosted_role_id)
BEGIN SELECT RAISE(ABORT,'publication_not_committed'); END;
