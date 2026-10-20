-- One correction per original award. The original payout, amount and Provider key stay intact.
-- Operators prepare pending rows before sending; only an exact Provider receipt settles paid.
CREATE TABLE card_reward_topups (
 id TEXT PRIMARY KEY,
 reward_id TEXT NOT NULL UNIQUE REFERENCES card_rewards(id),
 target_amount INTEGER NOT NULL CHECK(target_amount > 0),
 amount INTEGER NOT NULL CHECK(amount > 0 AND amount < target_amount),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','blocked_insufficient','failed')),
 provider_entry_id TEXT UNIQUE,
 error TEXT,
 requested_by TEXT NOT NULL REFERENCES members(id),
 created_at INTEGER NOT NULL,
 settled_at INTEGER,
 CHECK(status <> 'paid' OR (provider_entry_id IS NOT NULL AND settled_at IS NOT NULL))
);
CREATE INDEX card_reward_topups_status ON card_reward_topups(status, created_at);
CREATE TRIGGER card_reward_topups_validate BEFORE INSERT ON card_reward_topups
WHEN NOT EXISTS(SELECT 1 FROM card_rewards r WHERE r.id=NEW.reward_id AND r.status='paid'
 AND r.amount+NEW.amount=NEW.target_amount AND r.member_id<>NEW.requested_by)
BEGIN SELECT RAISE(ABORT,'card_reward_topup_invalid'); END;
CREATE TRIGGER card_reward_topups_immutable BEFORE UPDATE ON card_reward_topups
WHEN OLD.status='paid' OR NEW.id<>OLD.id OR NEW.reward_id<>OLD.reward_id
 OR NEW.target_amount<>OLD.target_amount OR NEW.amount<>OLD.amount
 OR NEW.requested_by<>OLD.requested_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'card_reward_topup_immutable'); END;
-- Respect the existing scoped maintenance barrier for the underlying work.
CREATE TRIGGER draft_transfer_hold_card_reward_topups_insert BEFORE INSERT ON card_reward_topups
WHEN EXISTS(SELECT 1 FROM card_rewards r JOIN draft_transfer_gate_nodes g
 ON g.node IN ('c:'||r.card_id,'r:'||r.work_key) WHERE r.id=NEW.reward_id)
BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_reward_topups_update BEFORE UPDATE ON card_reward_topups
WHEN EXISTS(SELECT 1 FROM card_rewards r JOIN draft_transfer_gate_nodes g
 ON g.node IN ('c:'||r.card_id,'r:'||r.work_key) WHERE r.id=OLD.reward_id)
BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_reward_topups_delete BEFORE DELETE ON card_reward_topups
WHEN EXISTS(SELECT 1 FROM card_rewards r JOIN draft_transfer_gate_nodes g
 ON g.node IN ('c:'||r.card_id,'r:'||r.work_key) WHERE r.id=OLD.reward_id)
BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER card_reward_topups_prepared_metric AFTER INSERT ON card_reward_topups BEGIN
 INSERT INTO ops_metrics(metric,operation,outcome,value) VALUES('card_reward','topup_request','success',1)
 ON CONFLICT(metric,operation,outcome) DO UPDATE SET value=value+1;
END;
CREATE TRIGGER card_reward_topups_settled_metric AFTER UPDATE OF status ON card_reward_topups
WHEN NEW.status<>OLD.status AND NEW.status IN ('paid','blocked_insufficient','failed') BEGIN
 INSERT INTO ops_metrics(metric,operation,outcome,value)
 VALUES('card_reward','topup',CASE NEW.status WHEN 'paid' THEN 'success' WHEN 'blocked_insufficient' THEN 'insufficient' ELSE 'error' END,1)
 ON CONFLICT(metric,operation,outcome) DO UPDATE SET value=value+1;
END;

-- First season: keep its dates and six-card weekly quota; only increase the award.
INSERT INTO audit_log(id,subject_kind,subject_id,actor_member_id,actor_kind,action,reason,before_json,after_json,operation_id,created_at)
 SELECT 'creator-reprice-20261020','card_reward','creator-season-1',NULL,'system','configure','Creator Season reward update',
 json_object('reward',reward,'weeklyLimit',weekly_limit),json_object('reward',20000,'weeklyLimit',weekly_limit),
 'creator-reprice-20261020',1792425600000 FROM card_reward_campaigns WHERE id='creator-season-1' AND reward<>20000;
UPDATE card_reward_campaigns SET reward=20000,updated_at=1792425600000 WHERE id='creator-season-1' AND reward<>20000;
