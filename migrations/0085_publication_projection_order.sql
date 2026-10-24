-- Replace approval pointers before marking a retained card approved. The
-- publication fence must validate the new revision, not its previous pointer.
DROP TRIGGER hosting_decision;
CREATE TRIGGER hosting_decision AFTER UPDATE OF status ON review_submissions
WHEN NEW.status IN ('approved','rejected') AND EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=NEW.id)
BEGIN
 UPDATE hosting_versions SET state=NEW.status WHERE submission_id=NEW.id;
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
 UPDATE cards SET status='approved' WHERE id=NEW.card_id AND approved_version_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=cards.provider AND p.source_role_id=cards.source_role_id AND (p.access<>'public' OR p.sync_state<>'complete'));
 UPDATE cards SET status='unshared' WHERE id=NEW.card_id AND approved_version_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=cards.provider AND p.source_role_id=cards.source_role_id AND (p.access<>'public' OR p.sync_state<>'complete'));
END;
