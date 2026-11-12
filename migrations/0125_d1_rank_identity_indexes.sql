-- Capturing first publication must not scan every registration or correction per card.
CREATE INDEX idx_registrations_source_time ON card_registrations(provider,source_role_id,registered_at);
CREATE INDEX idx_review_corrections_complete ON review_corrections(submission_id,original_decided_at) WHERE state='complete';

-- Public access checks resolve the small server-owned exclusion set once per request.
CREATE INDEX idx_members_test_ids ON members(id) WHERE account_class='test';
