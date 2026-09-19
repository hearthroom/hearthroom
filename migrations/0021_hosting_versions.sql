-- Issuer-owned review identity. No author credentials or private configuration here.
CREATE TABLE hosting_versions (
 version_id TEXT PRIMARY KEY,
 work_id TEXT NOT NULL,
 member_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 source_role_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider='harbor'),
 nsfw INTEGER NOT NULL,
 hosted_revision_id TEXT,
 card_id TEXT,
 submission_id TEXT UNIQUE,
 public_role TEXT,
 state TEXT NOT NULL DEFAULT 'preparing',
 created_at INTEGER NOT NULL,
 UNIQUE(member_id,operation_id)
);
CREATE UNIQUE INDEX hosting_one_submission ON hosting_versions(work_id) WHERE state='preparing';
ALTER TABLE cards ADD COLUMN approved_version_id TEXT;
ALTER TABLE cards ADD COLUMN approved_hosted_role_id TEXT;

-- Updates waiting for review must never replace an older approved projection.
CREATE TRIGGER hosting_decision AFTER UPDATE OF status ON review_submissions
WHEN NEW.status IN ('approved','rejected') AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE hosting_versions SET state=NEW.status WHERE submission_id=NEW.id;
 UPDATE cards SET status='approved'
 WHERE id=NEW.card_id AND approved_version_id IS NOT NULL;
 UPDATE cards SET
  approved_version_id=(SELECT version_id FROM hosting_versions WHERE submission_id=NEW.id),
  approved_hosted_role_id=(SELECT hosted_revision_id FROM hosting_versions WHERE submission_id=NEW.id),
  nsfw=NEW.nsfw,
  zone=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.zone'),
  names=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.names'),
  summaries=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.summaries'),
  avatar_url=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.avatarUrl'),
  background_url=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.backgroundUrl'),
  tags=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.tags')
 WHERE id=NEW.card_id AND NEW.status='approved';
END;

CREATE TRIGGER hosting_submission_guard BEFORE UPDATE OF submission_id ON hosting_versions
WHEN NEW.submission_id IS NOT NULL AND OLD.submission_id IS NULL
BEGIN
 SELECT CASE WHEN OLD.state<>'preparing' OR EXISTS(
  SELECT 1 FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id
  WHERE v.work_id=NEW.work_id AND s.status='pending'
 ) THEN RAISE(ABORT,'submission_pending') END;
END;

CREATE TRIGGER hosting_review_immutable BEFORE UPDATE ON review_submissions
WHEN OLD.content_hash LIKE 'version:%' AND (
 NEW.content_hash<>OLD.content_hash OR NEW.nsfw<>OLD.nsfw OR
 NEW.card_id<>OLD.card_id OR NEW.source_role_id<>OLD.source_role_id OR NEW.kind<>OLD.kind
)
BEGIN SELECT RAISE(ABORT,'hosted_revision_immutable'); END;
CREATE TRIGGER hosting_snapshot_immutable BEFORE UPDATE ON review_snapshots
WHEN EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=OLD.submission_id)
BEGIN SELECT RAISE(ABORT,'hosted_revision_immutable'); END;
