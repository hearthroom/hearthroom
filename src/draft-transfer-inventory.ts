// Mirrors migration 0073 scope predicates; guarded-table parity is tested.
export const gateInventory = [
  [
    "card_numbers",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id,'c:'||t.num))"
  ],
  [
    "cards",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id,'c:'||t.id))"
  ],
  [
    "works",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.source_provider||':'||t.source_role_id,'w:'||t.id))"
  ],
  [
    "work_copies",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.role_id,'w:'||t.work_id))"
  ],
  [
    "hosting_versions",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id,'w:'||t.work_id,'v:'||t.version_id,'c:'||t.card_id,'s:'||t.submission_id))"
  ],
  [
    "hosting_replicas",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id,'r:'||t.provider||':'||t.hosted_revision_id,'v:'||t.version_id))"
  ],
  [
    "hosting_transfers",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.draft_role_id,'r:'||t.provider||':'||t.hosted_revision_id,'v:'||t.version_id))"
  ],
  [
    "review_submissions",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id,'c:'||t.card_id,'s:'||t.id))"
  ],
  [
    "review_snapshots",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||t.submission_id))"
  ],
  [
    "review_stamps",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||t.submission_id))"
  ],
  [
    "review_deliveries",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('s:'||t.submission_id))"
  ],
  [
    "card_registrations",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id))"
  ],
  [
    "originality_texts",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||t.card_id,'s:'||t.submission_id))"
  ],
  [
    "originality_prints",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 's:'||submission_id FROM originality_texts WHERE id=t.text_id),(SELECT 'c:'||card_id FROM originality_texts WHERE id=t.text_id)))"
  ],
  [
    "card_rewards",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('c:'||t.card_id,'r:'||t.work_key))"
  ],
  [
    "moderation_state",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id))"
  ],
  [
    "moderation_cases",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id,'v:'||t.version_id,'c:'||t.card_number))"
  ],
  [
    "moderation_events",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id))"
  ],
  [
    "moderation_compensation",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('r:'||t.provider||':'||t.source_role_id))"
  ],
  [
    "moderation_votes",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ((SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=t.case_id)))"
  ],
  [
    "moderation_blocked_versions",
    "EXISTS(SELECT 1 FROM draft_transfer_gate_nodes WHERE node IN ('v:'||t.version_id,(SELECT 'r:'||provider||':'||source_role_id FROM moderation_cases WHERE id=t.case_id)))"
  ]
] as const;
