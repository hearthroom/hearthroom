-- Scoped operator maintenance barrier. No TTL and no mutable control state.
CREATE TABLE draft_transfer_gate_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider='harbor'), source_role_id TEXT NOT NULL,
 card_num INTEGER NOT NULL, operation TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation>0),
 phase TEXT NOT NULL CHECK(phase IN ('held','prepared','released')),
 baseline_digest TEXT NOT NULL, receipt_hash TEXT NOT NULL, evidence_hash TEXT NOT NULL,
 payload TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX draft_transfer_gate_latest_idx ON draft_transfer_gate_events(provider,source_role_id,seq DESC);
CREATE VIEW draft_transfer_gate_latest AS SELECT e.* FROM draft_transfer_gate_events e
 WHERE NOT EXISTS(SELECT 1 FROM draft_transfer_gate_events x WHERE x.provider=e.provider AND x.source_role_id=e.source_role_id AND x.seq>e.seq);
CREATE VIEW draft_transfer_gate_active AS SELECT * FROM draft_transfer_gate_latest WHERE phase<>'released';
CREATE TRIGGER draft_transfer_gate_no_update BEFORE UPDATE ON draft_transfer_gate_events BEGIN SELECT RAISE(ABORT,'draft_transfer_gate_immutable'); END;
CREATE TRIGGER draft_transfer_gate_no_delete BEFORE DELETE ON draft_transfer_gate_events BEGIN SELECT RAISE(ABORT,'draft_transfer_gate_immutable'); END;
CREATE TRIGGER draft_transfer_gate_transition BEFORE INSERT ON draft_transfer_gate_events
WHEN NEW.seq<>-1 OR EXISTS(SELECT 1 FROM draft_transfer_gate_events WHERE request_id=NEW.request_id)
 OR NOT EXISTS(SELECT 1 FROM card_numbers WHERE num=NEW.card_num AND provider=NEW.provider AND source_role_id=NEW.source_role_id)
 OR EXISTS(SELECT 1 FROM draft_transfer_gate_events WHERE (card_num=NEW.card_num OR (provider=NEW.provider AND source_role_id=NEW.source_role_id)) AND (scope<>NEW.scope OR card_num<>NEW.card_num OR provider<>NEW.provider OR source_role_id<>NEW.source_role_id))
 OR NOT (
  (NEW.phase='held' AND NEW.baseline_digest='' AND NEW.receipt_hash='' AND NEW.evidence_hash='' AND NEW.generation=COALESCE((SELECT generation+1 FROM draft_transfer_gate_latest WHERE provider=NEW.provider AND source_role_id=NEW.source_role_id AND phase='released'),1)
   AND NOT EXISTS(SELECT 1 FROM draft_transfer_gate_active WHERE card_num=NEW.card_num OR (provider=NEW.provider AND source_role_id=NEW.source_role_id)))
  OR (NEW.phase='prepared' AND length(NEW.baseline_digest)=64 AND NEW.receipt_hash='' AND NEW.evidence_hash='' AND EXISTS(SELECT 1 FROM draft_transfer_gate_latest e WHERE e.provider=NEW.provider AND e.source_role_id=NEW.source_role_id AND e.operation=NEW.operation AND e.generation=NEW.generation AND e.phase='held'))
  OR (NEW.phase='released' AND length(NEW.receipt_hash)=64 AND length(NEW.evidence_hash)=64 AND EXISTS(SELECT 1 FROM draft_transfer_gate_latest e WHERE e.provider=NEW.provider AND e.source_role_id=NEW.source_role_id AND e.operation=NEW.operation AND e.generation=NEW.generation AND e.phase='prepared' AND e.baseline_digest=NEW.baseline_digest))
 ) BEGIN SELECT RAISE(ABORT,'draft_transfer_gate_conflict'); END;
CREATE TRIGGER draft_transfer_gate_metric AFTER INSERT ON draft_transfer_gate_events BEGIN
 INSERT INTO ops_metrics(metric,operation,outcome,value) VALUES('draft_transfer_gate','transition','success',1)
 ON CONFLICT(metric,operation,outcome) DO UPDATE SET value=value+1;
END;
CREATE VIEW draft_transfer_gate_forward_0 AS
SELECT 'r:'||provider||':'||source_role_id a,'c:'||num b FROM card_numbers
UNION ALL
SELECT 'r:'||provider||':'||source_role_id a,'c:'||id b FROM cards
UNION ALL
SELECT 'r:'||source_provider||':'||source_role_id a,'w:'||id b FROM works
UNION ALL
SELECT 'r:'||provider||':'||role_id a,'w:'||work_id b FROM work_copies;
CREATE VIEW draft_transfer_gate_forward_1 AS
SELECT 'r:'||provider||':'||source_role_id a,'v:'||version_id b FROM hosting_versions
UNION ALL
SELECT 'w:'||work_id a,'v:'||version_id b FROM hosting_versions
UNION ALL
SELECT 'c:'||card_id a,'v:'||version_id b FROM hosting_versions
UNION ALL
SELECT 's:'||submission_id a,'v:'||version_id b FROM hosting_versions;
CREATE VIEW draft_transfer_gate_forward_2 AS
SELECT 'r:'||provider||':'||source_role_id a,'v:'||version_id b FROM hosting_replicas
UNION ALL
SELECT 'r:'||provider||':'||hosted_revision_id a,'v:'||version_id b FROM hosting_replicas
UNION ALL
SELECT 'r:'||provider||':'||draft_role_id a,'v:'||version_id b FROM hosting_transfers
UNION ALL
SELECT 'r:'||provider||':'||hosted_revision_id a,'v:'||version_id b FROM hosting_transfers;
CREATE VIEW draft_transfer_gate_forward_3 AS
SELECT 'r:'||provider||':'||source_role_id a,'s:'||id b FROM review_submissions
UNION ALL
SELECT 'c:'||card_id a,'s:'||id b FROM review_submissions;
CREATE VIEW draft_transfer_gate_forward AS
SELECT * FROM draft_transfer_gate_forward_0
UNION ALL
SELECT * FROM draft_transfer_gate_forward_1
UNION ALL
SELECT * FROM draft_transfer_gate_forward_2
UNION ALL
SELECT * FROM draft_transfer_gate_forward_3;
CREATE VIEW draft_transfer_gate_edges AS
 SELECT CASE direction.n WHEN 0 THEN f.a ELSE f.b END a, CASE direction.n WHEN 0 THEN f.b ELSE f.a END b
 FROM draft_transfer_gate_forward f CROSS JOIN (SELECT 0 n UNION ALL SELECT 1) direction;
CREATE VIEW draft_transfer_gate_nodes AS
WITH RECURSIVE nodes(gate_seq,node) AS (
 SELECT seq,'r:'||provider||':'||source_role_id FROM draft_transfer_gate_active
 UNION SELECT seq,'c:'||card_num FROM draft_transfer_gate_active
 UNION SELECT n.gate_seq,e.b FROM nodes n JOIN draft_transfer_gate_edges e ON e.a=n.node WHERE e.b IS NOT NULL
) SELECT * FROM nodes;
CREATE TRIGGER draft_transfer_hold_card_numbers_insert BEFORE INSERT ON card_numbers WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'c:'||NEW.num)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_numbers_update BEFORE UPDATE ON card_numbers WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'c:'||OLD.num)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'c:'||NEW.num)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_numbers_delete BEFORE DELETE ON card_numbers WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'c:'||OLD.num)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_cards_insert BEFORE INSERT ON cards WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'c:'||NEW.id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_cards_update BEFORE UPDATE ON cards WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'c:'||OLD.id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'c:'||NEW.id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_cards_delete BEFORE DELETE ON cards WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'c:'||OLD.id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_works_insert BEFORE INSERT ON works WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.source_provider||':'||NEW.source_role_id,'w:'||NEW.id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_works_update BEFORE UPDATE ON works WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.source_provider||':'||OLD.source_role_id,'w:'||OLD.id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.source_provider||':'||NEW.source_role_id,'w:'||NEW.id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_works_delete BEFORE DELETE ON works WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.source_provider||':'||OLD.source_role_id,'w:'||OLD.id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_work_copies_insert BEFORE INSERT ON work_copies WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.role_id,'w:'||NEW.work_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_work_copies_update BEFORE UPDATE ON work_copies WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.role_id,'w:'||OLD.work_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.role_id,'w:'||NEW.work_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_work_copies_delete BEFORE DELETE ON work_copies WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.role_id,'w:'||OLD.work_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_hosting_versions_insert BEFORE INSERT ON hosting_versions WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'w:'||NEW.work_id,'v:'||NEW.version_id,'c:'||NEW.card_id,'s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_hosting_versions_update BEFORE UPDATE ON hosting_versions WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'w:'||OLD.work_id,'v:'||OLD.version_id,'c:'||OLD.card_id,'s:'||OLD.submission_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'w:'||NEW.work_id,'v:'||NEW.version_id,'c:'||NEW.card_id,'s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_hosting_versions_delete BEFORE DELETE ON hosting_versions WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'w:'||OLD.work_id,'v:'||OLD.version_id,'c:'||OLD.card_id,'s:'||OLD.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_hosting_replicas_insert BEFORE INSERT ON hosting_replicas WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'r:'||NEW.provider||':'||NEW.hosted_revision_id,'v:'||NEW.version_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_hosting_replicas_update BEFORE UPDATE ON hosting_replicas WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'r:'||OLD.provider||':'||OLD.hosted_revision_id,'v:'||OLD.version_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'r:'||NEW.provider||':'||NEW.hosted_revision_id,'v:'||NEW.version_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_hosting_replicas_delete BEFORE DELETE ON hosting_replicas WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'r:'||OLD.provider||':'||OLD.hosted_revision_id,'v:'||OLD.version_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_hosting_transfers_insert BEFORE INSERT ON hosting_transfers WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.draft_role_id,'r:'||NEW.provider||':'||NEW.hosted_revision_id,'v:'||NEW.version_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_hosting_transfers_update BEFORE UPDATE ON hosting_transfers WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.draft_role_id,'r:'||OLD.provider||':'||OLD.hosted_revision_id,'v:'||OLD.version_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.draft_role_id,'r:'||NEW.provider||':'||NEW.hosted_revision_id,'v:'||NEW.version_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_hosting_transfers_delete BEFORE DELETE ON hosting_transfers WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.draft_role_id,'r:'||OLD.provider||':'||OLD.hosted_revision_id,'v:'||OLD.version_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_submissions_insert BEFORE INSERT ON review_submissions WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'c:'||NEW.card_id,'s:'||NEW.id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_submissions_update BEFORE UPDATE ON review_submissions WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'c:'||OLD.card_id,'s:'||OLD.id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'c:'||NEW.card_id,'s:'||NEW.id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_submissions_delete BEFORE DELETE ON review_submissions WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'c:'||OLD.card_id,'s:'||OLD.id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_snapshots_insert BEFORE INSERT ON review_snapshots WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_snapshots_update BEFORE UPDATE ON review_snapshots WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||OLD.submission_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_snapshots_delete BEFORE DELETE ON review_snapshots WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||OLD.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_stamps_insert BEFORE INSERT ON review_stamps WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_stamps_update BEFORE UPDATE ON review_stamps WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||OLD.submission_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_stamps_delete BEFORE DELETE ON review_stamps WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||OLD.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_deliveries_insert BEFORE INSERT ON review_deliveries WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_deliveries_update BEFORE UPDATE ON review_deliveries WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||OLD.submission_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_review_deliveries_delete BEFORE DELETE ON review_deliveries WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||OLD.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_registrations_insert BEFORE INSERT ON card_registrations WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_registrations_update BEFORE UPDATE ON card_registrations WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_registrations_delete BEFORE DELETE ON card_registrations WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_originality_texts_insert BEFORE INSERT ON originality_texts WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||NEW.card_id,'s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_originality_texts_update BEFORE UPDATE ON originality_texts WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||OLD.card_id,'s:'||OLD.submission_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||NEW.card_id,'s:'||NEW.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_originality_texts_delete BEFORE DELETE ON originality_texts WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||OLD.card_id,'s:'||OLD.submission_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_originality_prints_insert BEFORE INSERT ON originality_prints WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 's:'||submission_id FROM originality_texts WHERE id=NEW.text_id),(SELECT 'c:'||card_id FROM originality_texts WHERE id=NEW.text_id))) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_originality_prints_update BEFORE UPDATE ON originality_prints WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 's:'||submission_id FROM originality_texts WHERE id=OLD.text_id),(SELECT 'c:'||card_id FROM originality_texts WHERE id=OLD.text_id))) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 's:'||submission_id FROM originality_texts WHERE id=NEW.text_id),(SELECT 'c:'||card_id FROM originality_texts WHERE id=NEW.text_id))) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_originality_prints_delete BEFORE DELETE ON originality_prints WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 's:'||submission_id FROM originality_texts WHERE id=OLD.text_id),(SELECT 'c:'||card_id FROM originality_texts WHERE id=OLD.text_id))) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_rewards_insert BEFORE INSERT ON card_rewards WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||NEW.card_id,'r:'||NEW.work_key)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_rewards_update BEFORE UPDATE ON card_rewards WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||OLD.card_id,'r:'||OLD.work_key)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||NEW.card_id,'r:'||NEW.work_key)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_card_rewards_delete BEFORE DELETE ON card_rewards WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||OLD.card_id,'r:'||OLD.work_key)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_state_insert BEFORE INSERT ON moderation_state WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_state_update BEFORE UPDATE ON moderation_state WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_state_delete BEFORE DELETE ON moderation_state WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_cases_insert BEFORE INSERT ON moderation_cases WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'v:'||NEW.version_id,'c:'||NEW.card_number)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_cases_update BEFORE UPDATE ON moderation_cases WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'v:'||OLD.version_id,'c:'||OLD.card_number)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id,'v:'||NEW.version_id,'c:'||NEW.card_number)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_cases_delete BEFORE DELETE ON moderation_cases WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id,'v:'||OLD.version_id,'c:'||OLD.card_number)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_events_insert BEFORE INSERT ON moderation_events WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_events_update BEFORE UPDATE ON moderation_events WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_events_delete BEFORE DELETE ON moderation_events WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_compensation_insert BEFORE INSERT ON moderation_compensation WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_compensation_update BEFORE UPDATE ON moderation_compensation WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id)) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||NEW.provider||':'||NEW.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_compensation_delete BEFORE DELETE ON moderation_compensation WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||OLD.provider||':'||OLD.source_role_id)) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_votes_insert BEFORE INSERT ON moderation_votes WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=NEW.case_id))) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_votes_update BEFORE UPDATE ON moderation_votes WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=OLD.case_id))) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=NEW.case_id))) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_votes_delete BEFORE DELETE ON moderation_votes WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=OLD.case_id))) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_blocked_versions_insert BEFORE INSERT ON moderation_blocked_versions WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('v:'||NEW.version_id,(SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=NEW.case_id))) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_blocked_versions_update BEFORE UPDATE ON moderation_blocked_versions WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('v:'||OLD.version_id,(SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=OLD.case_id))) OR EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('v:'||NEW.version_id,(SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=NEW.case_id))) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
CREATE TRIGGER draft_transfer_hold_moderation_blocked_versions_delete BEFORE DELETE ON moderation_blocked_versions WHEN EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('v:'||OLD.version_id,(SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=OLD.case_id))) BEGIN SELECT RAISE(ABORT,'draft_transfer_held'); END;
