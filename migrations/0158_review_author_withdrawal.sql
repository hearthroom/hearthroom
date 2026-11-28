-- The author operation and review are linked by the exact publication permit.
-- A pending intent blocks review only while it still owns the work's fence.
CREATE VIEW review_author_withdrawals AS
SELECT v.submission_id,'pending' AS state
FROM hosting_versions v
JOIN work_publication_permits p ON p.version_id=v.version_id AND p.state='prepared'
JOIN managed_work_access w ON w.work_id=v.work_id AND w.sync_state='changing'
JOIN author_visibility_operations a ON a.work_id=w.work_id AND a.provider_operation_id=w.sync_operation_id
WHERE v.state='pending' AND a.state='pending'
  AND json_extract(a.intent,'$.action')='cancel_review'
  AND json_extract(a.command,'$.permitId')=p.operation_id
UNION ALL
SELECT v.submission_id,'complete' AS state
FROM hosting_versions v
JOIN work_publication_permits p ON p.version_id=v.version_id AND p.state='cancelled'
JOIN author_visibility_operations a ON a.work_id=v.work_id AND a.state='complete'
WHERE v.state='superseded'
  AND json_extract(a.intent,'$.action')='cancel_review'
  AND json_extract(a.command,'$.permitId')=p.operation_id;

-- The author can claim the fence after the reviewer has already loaded the form.
-- Abort the whole stamp batch, including events and any publication decision.
CREATE TRIGGER review_stamp_author_withdrawal_guard
BEFORE INSERT ON review_stamps
WHEN EXISTS (SELECT 1 FROM review_author_withdrawals WHERE submission_id=NEW.submission_id)
BEGIN
  SELECT RAISE(ABORT,'review_withdrawal_blocked');
END;
