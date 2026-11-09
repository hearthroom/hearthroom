-- Resolve legacy IDs without scanning every card and its hosted revisions.
CREATE INDEX idx_cards_source_role ON cards (source_role_id);
CREATE INDEX idx_cards_approved_hosted_role ON cards (approved_hosted_role_id) WHERE approved_hosted_role_id IS NOT NULL;
CREATE INDEX idx_hosting_versions_approved_revision ON hosting_versions (hosted_revision_id, card_id) WHERE state = 'approved';
CREATE INDEX idx_hosting_replicas_ready_revision ON hosting_replicas (hosted_revision_id, version_id) WHERE state = 'ready';

-- Sandbox saves read the registered card's version history on each load.
CREATE INDEX idx_hosting_versions_card ON hosting_versions (card_id, hosted_revision_id);
