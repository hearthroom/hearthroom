-- Additive review delivery state. No author/private snapshot is copied here.
ALTER TABLE review_submissions ADD COLUMN claim_generation TEXT NOT NULL DEFAULT '';
UPDATE review_submissions SET claim_generation=lower(hex(randomblob(16))) WHERE claimed_by IS NOT NULL;
ALTER TABLE community_notifications ADD COLUMN review_submission TEXT;
ALTER TABLE community_notifications ADD COLUMN review_generation TEXT;
ALTER TABLE community_notifications ADD COLUMN review_link_version TEXT;
CREATE TABLE review_deliveries (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('main','digest')),
 submission_id TEXT, revision INTEGER NOT NULL DEFAULT 1, delivered_revision INTEGER NOT NULL DEFAULT 0,
 channel_id TEXT, message_id TEXT, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 due_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, terminal_at INTEGER
);
CREATE INDEX review_deliveries_due ON review_deliveries(due_at,lease_until);
CREATE TRIGGER review_delivery_insert AFTER INSERT ON review_submissions BEGIN
 INSERT INTO review_deliveries(id,kind,submission_id,updated_at) VALUES('review:'||NEW.id,'main',NEW.id,NEW.submitted_at);
END;
CREATE TRIGGER review_delivery_update AFTER UPDATE OF status,claimed_by,claimed_at,claim_generation,nsfw,content_hash ON review_submissions BEGIN
 UPDATE review_deliveries SET revision=revision+1,due_at=0,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE submission_id=NEW.id;
END;
CREATE TRIGGER review_delivery_stamp AFTER INSERT ON review_stamps BEGIN
 UPDATE review_deliveries SET revision=revision+1,due_at=0,updated_at=NEW.created_at WHERE submission_id=NEW.submission_id;
END;
CREATE TRIGGER review_delivery_card AFTER UPDATE OF status,public_blocked,names ON cards BEGIN
 UPDATE review_deliveries SET revision=revision+1,due_at=0,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE submission_id IN(SELECT id FROM review_submissions WHERE card_id=NEW.id);
END;
CREATE TRIGGER review_delivery_card_delete AFTER DELETE ON cards BEGIN
 UPDATE review_deliveries SET revision=revision+1,due_at=0,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE submission_id IN(SELECT id FROM review_submissions WHERE card_id=OLD.id);
END;
INSERT INTO review_deliveries(id,kind,submission_id,updated_at)
 SELECT 'review:'||id,'main',id,submitted_at FROM review_submissions WHERE status='pending';
ALTER TABLE review_stamps ADD COLUMN claim_generation TEXT NOT NULL DEFAULT '';
CREATE TRIGGER review_stamp_claim_guard BEFORE INSERT ON review_stamps
 WHEN NEW.claim_generation<>'' AND NOT EXISTS (
 SELECT 1 FROM review_submissions s WHERE s.id=NEW.submission_id AND s.status='pending'
 AND s.claimed_by=NEW.member_id AND s.claim_generation=NEW.claim_generation AND s.claimed_at>NEW.created_at-2700000
 AND NOT EXISTS(SELECT 1 FROM reviewers r WHERE r.member_id=NEW.member_id AND r.revoked_at IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'claim changed'); END;
