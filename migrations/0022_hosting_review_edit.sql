-- Editing never revokes the published revision. A retired pending review is
-- terminal, including for a reviewer request already in flight when save began.
CREATE TRIGGER hosting_review_superseded AFTER UPDATE OF status ON review_submissions
WHEN NEW.status='superseded' AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE hosting_versions SET state='superseded' WHERE submission_id=NEW.id;
END;

CREATE TRIGGER hosting_review_terminal BEFORE UPDATE OF status ON review_submissions
WHEN OLD.status<>'pending' AND NEW.status<>OLD.status
 AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'submission already decided'); END;

-- Switch searchable/public metadata in the same transaction as the live pointer.
CREATE TRIGGER hosting_review_search AFTER UPDATE OF status ON review_submissions
WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE cards SET
  search_text=COALESCE(json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.searchText'),search_text),
  slug=json_extract((SELECT public_role FROM hosting_versions WHERE submission_id=NEW.id),'$.slug')
 WHERE id=NEW.card_id;
END;

CREATE TRIGGER hosting_stamp_pending BEFORE INSERT ON review_stamps
WHEN EXISTS(SELECT 1 FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id
 WHERE s.id=NEW.submission_id AND s.status<>'pending')
BEGIN SELECT RAISE(ABORT,'submission already decided'); END;
