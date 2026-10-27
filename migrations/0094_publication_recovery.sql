-- A cancellation still owns the slot until its Provider fence is confirmed.
DROP INDEX hosting_one_submission;
CREATE UNIQUE INDEX hosting_one_submission ON hosting_versions(work_id)
 WHERE state IN ('preparing','cancelling');

-- An old Worker may return after an edit/cancel. Its final batch must roll back,
-- including quota, snapshots and search fingerprints, rather than revive it.
CREATE TRIGGER hosting_retired_submission_guard BEFORE UPDATE ON hosting_versions
WHEN OLD.submission_id IS NULL AND OLD.state IN ('cancelling','superseded')
 AND (NEW.submission_id IS NOT NULL OR NEW.state NOT IN ('cancelling','superseded'))
BEGIN SELECT RAISE(ABORT,'hosting_operation_conflict'); END;

CREATE TRIGGER hosting_retired_permit_guard BEFORE INSERT ON work_publication_permits
WHEN EXISTS(SELECT 1 FROM hosting_versions v WHERE v.version_id=NEW.version_id
 AND v.submission_id IS NULL AND v.state IN ('cancelling','superseded'))
BEGIN SELECT RAISE(ABORT,'hosting_operation_conflict'); END;

CREATE TRIGGER hosting_cancelled_permit_guard BEFORE UPDATE ON work_publication_permits
WHEN OLD.state='cancelled' AND NEW.state<>'cancelled'
BEGIN SELECT RAISE(ABORT,'hosting_operation_conflict'); END;
