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
 moderation_revision INTEGER NOT NULL DEFAULT 0,
 confirmed_moderation_revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(provider,source_role_id)
);
CREATE TABLE visibility_operations (
 work_id TEXT NOT NULL REFERENCES works(id),
 operation_id TEXT NOT NULL,
 root_operation_id TEXT NOT NULL,
 command TEXT NOT NULL,
 intent_hash TEXT NOT NULL,
 moderation_revision INTEGER,
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

-- A moderation decision persists its revision in the same D1 transaction,
-- before a network call can fail or an older handler resume.
CREATE TRIGGER managed_moderation_revision AFTER UPDATE OF board_hidden,public_blocked ON moderation_state
WHEN OLD.board_hidden IS NOT NEW.board_hidden OR OLD.public_blocked IS NOT NEW.public_blocked
BEGIN
 UPDATE managed_work_access SET moderation_revision=moderation_revision+1
 WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id;
END;

-- Retain previous approval identity on rejection without making a private card public.
DROP TRIGGER hosting_decision;
CREATE TRIGGER hosting_decision AFTER UPDATE OF status ON review_submissions
WHEN NEW.status IN ('approved','rejected') AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE hosting_versions SET state=NEW.status WHERE submission_id=NEW.id;
 UPDATE cards SET status='approved' WHERE id=NEW.card_id AND approved_version_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=cards.provider AND p.source_role_id=cards.source_role_id AND (p.access<>'public' OR p.sync_state<>'complete'));
 UPDATE cards SET status='unshared' WHERE id=NEW.card_id AND approved_version_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=cards.provider AND p.source_role_id=cards.source_role_id AND (p.access<>'public' OR p.sync_state<>'complete'));
 UPDATE cards SET
  approved_version_id=(SELECT version_id FROM hosting_versions WHERE submission_id=NEW.id),
  approved_hosted_role_id=(SELECT hosted_revision_id FROM hosting_versions WHERE submission_id=NEW.id),
  rating=NEW.rating,
  rating_descriptors=NEW.rating_descriptors,
  zone=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.zone'),
  names=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.names'),
  summaries=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.summaries'),
  background_url=COALESCE(NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.backgroundUrl'),''),json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.avatarUrl')),
  share_image_url=NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.shareImageUrl'),''),
  landscape_url=NULLIF(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.backgroundLandscapeUrl'),''),
  tags=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.tags')
 WHERE id=NEW.card_id AND NEW.status='approved';
END;
