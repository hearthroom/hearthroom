-- 創作季第一期延長一個月（owner 2026-10-30）：結束改為台北 12-01 00:00。獎勵、每週額度、公開天數不變。
-- 只改還是原結束時間的那一列；已經被改過就不動。
INSERT INTO audit_log(id,subject_kind,subject_id,actor_member_id,actor_kind,action,reason,before_json,after_json,operation_id,created_at)
 SELECT 'creator-extend-20261030','card_reward','creator-season-1',NULL,'system','configure','Creator Season extended one month',
 json_object('endsAt',ends_at),json_object('endsAt',1796054400000),
 'creator-extend-20261030',1793361600000 FROM card_reward_campaigns WHERE id='creator-season-1' AND ends_at=1793462400000;
UPDATE card_reward_campaigns SET ends_at=1796054400000,updated_at=1793361600000 WHERE id='creator-season-1' AND ends_at=1793462400000;
