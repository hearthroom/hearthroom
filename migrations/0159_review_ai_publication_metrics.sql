-- Count effective publication after both local approval and managed visibility sync.
CREATE TRIGGER review_ai_effective_publication_metric AFTER UPDATE OF status ON review_submissions
WHEN OLD.status='pending' AND NEW.status='approved'
 AND EXISTS(SELECT 1 FROM review_stamps WHERE submission_id=NEW.id AND member_id='system:ai-fast-track' AND verdict='approve')
BEGIN
 INSERT INTO ops_metrics(metric,operation,outcome,value)
 VALUES('review_ai_auto_approve',CASE NEW.kind WHEN 'first' THEN 'new_card' ELSE 'update' END,'published',1)
 ON CONFLICT(metric,operation,outcome) DO UPDATE SET value=value+1;
END;
